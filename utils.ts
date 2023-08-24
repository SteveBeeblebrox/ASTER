namespace ASTER {
  namespace Util {
    export function splitGraphemes(text: string) {
      return Array.from(new Intl.Segmenter("en", {granularity: 'grapheme'}).segment(text), ({segment}) => segment);
    }
  }
  export type TokenMatcherCaptures = Map<string, Token[]|null>;
  export type TokenPosition = {start: number, length: number};
  export type TokenPattern = { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): number }
  export type SingleTokenPattern = TokenPattern & { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1|0|1 }
  export type NonConsumingTokenPattern = TokenPattern & { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1|0 }
  export type TokenArgs = {tags?: string | string[], props?: object | Map<string,any>, children?: Token[]}
  export type Tokenizer = {
    pattern: TokenPattern,
    recursive?: boolean
    result: string | ((matches: Token[], position: TokenPosition, captures: TokenMatcherCaptures)=> Token | Token[])
  }

  export class Token {
    private readonly tags: string[];
    private readonly properties: Map<string,any>;
    private readonly children?: Token[];
    constructor(private readonly name: string, private readonly position: TokenPosition, {tags = [], props = {}, children = undefined}: TokenArgs = {}) {
      if(typeof tags === 'string') this.tags = tags.split(/,|\s+/g).filter(x=>x);
      else this.tags = [...tags];

      if(props instanceof Map) this.properties = props;
      else this.properties = new Map(Object.entries(props));

      this.children = children;
    }
    public getName(): string {
      return this.name;
    }
    public hasTag(tag: string): boolean {
      return this.tags.includes(tag);
    }
    public hasProp(prop: string): boolean {
      return this.properties.has(prop);
    }
    public getProp(prop: string): any {
      return this.properties.get(prop);
    }
    public hasChildren(): boolean {
      return !!this.children?.length
    }
    public getChildren(): Token[] {
      return this.hasChildren() ? [...this.children!] : [];
    }
    public getStart(): number {
      return this.position.start;
    }
    public getLength(): number {
      return this.position.length;
    }
    public getRawValue(): string {
      return this.children?.map(o => o.getRawValue()).join('') ?? '';
    }
  }
  export class CharToken extends Token {
    constructor(private readonly value: string, position: TokenPosition, {tags, props}: Omit<TokenArgs, 'children'> = {}) {
      super('CHAR', position, {tags, props})
    }
    public getValue() {
      return this.value;
    }
    public getRawValue() {
      return this.getValue();
    }
  }
  class SpecialToken extends Token {
    constructor(name: string, position: TokenPosition, {tags, props}: Omit<TokenArgs, 'children'> = {}) {
      super(name, position, {tags, props})
    }
    public getRawValue() {
      return '';
    }
  }
  export function tokenize(text: string, tokenizers: Tokenizer[]): Token[] {
    // Split code points
    const tokens = [new SpecialToken('SOF', {start: -1, length: 0}), ...[...text].map((value,i) => new CharToken(value, {start: i, length: value.length})),new SpecialToken('EOF', {start: text.length, length: 0})];

    function applyTokenizer(tokenizer: Tokenizer): boolean {
      let applied = false;
      for(let i = 0; i < tokens.length; i++) {
        const captures = new Map();
        const matches = tokenizer.pattern.matches(tokens.slice(i),captures,tokens.slice(0,i));
        if(matches !== -1) {
          const matchedTokens = tokens.slice(i,i+matches);
          const position = {start: (matchedTokens[0]??tokens[i]).getStart(),length:matchedTokens.reduce((sum,token)=>sum+token.getLength(),0)};
          const newTokens = typeof tokenizer.result === 'string' ? new Token(tokenizer.result,position,{children:matchedTokens,props:captures}) : tokenizer.result(matchedTokens, position, captures);
          tokens.splice(i,matches, ...(Array.isArray(newTokens) ? newTokens : [newTokens]));
          applied ||= true;
        }
      }
      return applied;
    }

    for(const tokenizer of tokenizers) {
      applyTokenizer(tokenizer);
    }

    const recursiveTokenizers = tokenizers.filter(tokenizer => tokenizer.recursive);

    let mutated;
    do {
      mutated = false;
      for(const tokenizer of recursiveTokenizers) mutated ||= applyTokenizer(tokenizer);
    } while(mutated);

    return tokens;
  }
  export namespace TokenMatchers {
    function matchSingle(matched: boolean): -1 | 1 {
      return 1-2*+!matched as (-1 | 1);
    }
    export function tk(value: string): SingleTokenPattern {
      return {
        matches([token]) {
          return matchSingle(token && token.getName() === value)
        }
      }
    }
    export function char(value: string): SingleTokenPattern {
      return {
        matches([token]) {
          return matchSingle(token instanceof CharToken && token.getValue() === value);
        }
      }
    }
    export function str(value: string): TokenPattern {
        return {
            matches(tokens) {
                for(let i = 0; i < value.length; i++) {
                    const token = tokens[i];
                    if(!(token instanceof ASTER.CharToken) || token.getValue() !== value[i])
                        return -1;
                }
                return value.length;
            }
        }
    }
    export function capture(name: string, matcher: TokenPattern): TokenPattern {
      return {
        matches(tokens, captures, previousTokens) {
          const matches = matcher.matches(tokens, captures, previousTokens);
          if(matches !== -1) captures.set(name, tokens.slice(0,matches));
          else captures.set(name, null);
          return matches;
        }
      }
    }
    export function wildchar(pattern: '*' | '~' | '$' = '*'): SingleTokenPattern {
      const matches = (function(): (tokens: Token[])=> -1 | 1 {
        switch(pattern) {
          case '*': return ([token]) => matchSingle(token instanceof CharToken);
          case '~': return ([token]) => matchSingle(token instanceof CharToken && /^\s$/.test(token?.getValue?.()));
          case '$': return ([token]) => matchSingle(token instanceof CharToken && /\d$/.test(token?.getValue?.()));
          default: throw 'NYI'
        }
      })();
      
      return {
        matches
      }
    }

    export function seq(...matchers: TokenPattern[]): TokenPattern {
      return {
        matches(tokens,captures,previousTokens) {
          let matches = 0;
          for(let i = 0; i < matchers.length; i++) {
            const c = matchers[i].matches(tokens.slice(matches),captures,[...previousTokens, ...tokens.slice(0, matches)]);
            if(c !== -1) matches+=c;
            else return -1;
          }
          return matches;
        }
      }
    }

    export function count(matcher: TokenPattern, {min=1,max=-1} = {}): TokenPattern {
      return {
        matches(tokens,captures,previousTokens) {
          let numCountMatches = 0, matchedTokenCount = 0;
          while(max === -1 || numCountMatches <= max) {
            const matches = matcher.matches(tokens.slice(matchedTokenCount),captures,[...previousTokens, ...tokens.slice(0, matchedTokenCount)]);
            if(matches === -1)
              break;
            matchedTokenCount+=matches;
            numCountMatches++
          }
          if(numCountMatches>=min) return matchedTokenCount;
          else if(min === 0) return 0;
          return -1;
        }
      }
    }

    export function any(matcher: TokenPattern): TokenPattern {
      return count(matcher, {min: 0});
    }

    export function optional(matcher: TokenPattern): TokenPattern {
      return count(matcher, {min: 0, max: 1});
    }

    export function or(...matchers: TokenPattern[]): TokenPattern
    export function or(...matchers: SingleTokenPattern[]): SingleTokenPattern
    export function or(...matchers: TokenPattern[]): TokenPattern {
      return {
        matches(tokens, captures, previousTokens) {
          for(const matcher of matchers) {
            const matches = matcher.matches(tokens, captures, previousTokens);
            if(matches !== -1) return matches;
          }
          return -1;
        }
      }
    }

    export function not(matcher: SingleTokenPattern): SingleTokenPattern {
      return {
        matches([token], captures, previousTokens) {
          if(!token) return -1;
          const i = matcher.matches([token], captures, previousTokens)
          return i*-1 + -1*+!i as (-1|0|1);
        }
      }
    }

    export function hasprop(name: string): SingleTokenPattern {
      return {
        matches([token]) {
          return matchSingle(token?.hasProp?.(name));
        }
      }
    }

    export function propeq(name: string, value: any): SingleTokenPattern {
      return {
        matches([token]) {
          return matchSingle(token?.hasProp?.(name) && token?.getProp?.(name) === value);
        }
      }
    }

    export function is(tag: string): SingleTokenPattern {
      return {
        matches([token]) {
          return matchSingle(token?.hasTag?.(tag));
        }
      }
    }

    export function and(...matchers: TokenPattern[]): TokenPattern
    export function and(...matchers: SingleTokenPattern[]): SingleTokenPattern
    export function and(...matchers: TokenPattern[]): TokenPattern {
      return {
        matches(tokens, captures, previousTokens) {
          return Math.min(...matchers.map(matcher=>matcher.matches(tokens, captures, previousTokens)));
        }
      }
    }

    export function re(pattern: string, {ignoreCase = false} = {}): TokenPattern {
      return {
        matches(tokens, captures, previousTokens) {
          let nextStr = '';
          for(const token of tokens) {
            if(token instanceof CharToken)
              nextStr += token.getValue();
            else
              break;
          }
          let startOffset = 0;
          for(const token of previousTokens.reverse()) {
            if(token instanceof CharToken) {
              nextStr = token.getValue() + nextStr;
              startOffset++;
            } else {
              break;
            }
          }
          const regex = new RegExp(pattern, 'gud' + 'i'.repeat(+ignoreCase));
          regex.lastIndex = startOffset;
          const matches = regex.exec(nextStr);
          //console.log(nextStr, regex.lastIndex)
          if(matches?.indices?.[0]?.[0] === startOffset) {
            // @ts-expect-error
            Object.entries(matches.groups ?? {}).forEach(([key,value])=>captures.set(key,[...value].map(c=>new CharToken(c, {start: tokens[0].getStart()+matches.indices.groups[key][0], length: 1}))));
            return regex.lastIndex - startOffset;
          }
          return -1;
        }
      }
    }
    export function lambda(f: (token:Token)=>boolean): SingleTokenPattern {
      return {
        matches([token]) {
          return matchSingle(f(token));
        }
      }
    }
    export function next(matcher: TokenPattern): NonConsumingTokenPattern {
      return {
        matches(tokens, captures, previousTokens) {
          return matcher.matches(tokens, captures, previousTokens) >= 0 ? 0 : -1;
        }
      }
    }
    export function prev(matcher: TokenPattern): NonConsumingTokenPattern {
      return {
        matches(tokens, captures, previousTokens) {
          return matcher.matches(previousTokens.reverse(), captures, []) >= 0 ? 0 : -1;
        }
      }
    }
  }
}

namespace ASTERLang {
    const {seq,char,capture,wildchar,count,tk,or,and,prev,next,not,hasprop,propeq,re,is,lambda,any,optional} = ASTER.TokenMatchers;
    const IDENT = re(String.raw`(?:[a-z][a-z0-9_\-]*:)?[a-z][a-z0-9_\-]*`, {ignoreCase: true})
    type LogicTokenReducer = (t: LogicToken) => ASTER.TokenPattern;
    class LogicToken extends ASTER.Token {
        private constructor(name: string, position: ASTER.TokenPosition, args: ASTER.TokenArgs, private readonly reducer: LogicTokenReducer) {
            super(name, position, args);
        }
        static of(name: string, reducer: LogicTokenReducer) {
            return function(matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
                return new LogicToken(name, position, {children: matches, props: captures, tags: 'logic'}, reducer);
            }
        }
        reduce(): ASTER.TokenPattern {
            return this.reducer(this);
        }
    }

    class EscapedToken extends ASTER.Token {
        private constructor(name: string, position: ASTER.TokenPosition, args: ASTER.TokenArgs) {
            super(name, position, args);
        }
        static of(name: string) {
            return function(matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
                return new EscapedToken(name, position, {children: matches, props: captures, tags: 'escaped'});
            }
        }

        getRawValue(): string {
            return this.getChildren()[1].getRawValue();
        }
    }

    function getCapturedData(token: ASTER.Token, name: string) {
        const tokens = token.getProp(name) as LogicToken[]
        return {
            getRawValue() {
                return tokens.map(t => t?.getRawValue()).join('') ?? '';
            },
            reduce() {
                return tokens[0].reduce()
            },
            tokens
        }
    }
    const GRAMMAR: ASTER.Tokenizer[] = [
        // \\\\
        {pattern: seq(char('\\'), char('\\')), result: EscapedToken.of('asterlang:escaped-escape')}, // \\
        // \\\"
        {pattern: seq(char('\\'), char('"')), result: EscapedToken.of('asterlang:escaped-quote')}, // \"
        // \\\/
        {pattern: seq(char('\\'), char('/')), result: EscapedToken.of('asterlang:escaped-slash')}, // \/
        // \\\~
        {pattern: seq(char('\\'), wildchar('~')), result: EscapedToken.of('asterlang:escaped-ws')}, // \ 

        // \" (* || @asterlang:escaped-quote || @asterlang:escaped-escape)+ \"
        {pattern: seq(char('"'), capture('data',any(or(not(char('"')), is('escaped')))), char('"')), result: LogicToken.of('asterlang:string', function(t) {
            return ASTER.TokenMatchers.str(getCapturedData(t, 'data').getRawValue())
        })},

        // \/ (* || #escaped).. \/ \i?
        {pattern: seq(char('/'), capture('value', count(or(not(char('/')), is('escaped')))), char('/'), capture('i',optional(char('i')))), result: LogicToken.of('asterlang:re', function(t) {
            const text = (t.getProp('value') as ASTER.Token[]).map(function(t) {
                return t instanceof EscapedToken ? '\\' + t.getRawValue() : t.getRawValue();
            }).join('')
            return ASTER.TokenMatchers.re(text, {ignoreCase: getCapturedData(t, 'i').getRawValue() === 'i'});
        })}, // /pattern/i

        // ~
        {pattern: wildchar('~'), result: ()=>[]},

        // #escaped
        {pattern: is('escaped'), result: ([t],position) => [
            new ASTER.CharToken('\\', {start: position.start, length: 1}),
            new ASTER.CharToken((t as EscapedToken).getRawValue(), {start: position.length + 1, length: 1})
        ]},        

        // \\*
        {pattern: seq(char('\\'), capture('what', wildchar())), result: LogicToken.of('asterlang:char', function(t) {
            return ASTER.TokenMatchers.char(getCapturedData(t, 'what').getRawValue())
        })}, // \c

        // \*
        {pattern: char('*'), result: LogicToken.of('asterlang:wildchar-any', function() {
            return ASTER.TokenMatchers.wildchar('*');
        })}, // *
        // \$
        {pattern: char('$'), result: LogicToken.of('asterlang:wildchar-digit', function() {
            return ASTER.TokenMatchers.wildchar('$');
        })}, // $
        // \~
        {pattern: char('~'), result: LogicToken.of('asterlang:wildchar-digit', function() {
            return ASTER.TokenMatchers.wildchar('~');
        })}, // ~

        // \( #logic \)
        {pattern: seq(char('('), capture('value', is('logic')), char(')')), result: LogicToken.of('asterlang:group', function(t) {
            return getCapturedData(t, 'value').reduce();
        }), recursive: true}, // (pattern)

        // /[a-z0-9_]+/i \: #logic
        {pattern: seq(capture('name',IDENT), char(':'), capture('value',is('logic'))), result: LogicToken.of('asterlang:capture', function(t) {
            return ASTER.TokenMatchers.capture(getCapturedData(t,'name').getRawValue(), getCapturedData(t, 'value').reduce());
        }), recursive: true}, //name: pattern


        // #logic \+
        {pattern: seq(capture('value',is('logic')),char('+')), result: LogicToken.of('asterlang:any', function(t) {
            return ASTER.TokenMatchers.any(getCapturedData(t, 'value').reduce());
        }), recursive: true}, //#logic+

        // #logic \?
        {pattern: seq(capture('value',is('logic')),char('?')), result: LogicToken.of('asterlang:optional', function(t) {
            return ASTER.TokenMatchers.optional(getCapturedData(t, 'value').reduce());
        }), recursive: true}, //#logic?

        // #logic $+ \.\. $+
        {pattern: seq(capture('value', is('logic')), capture('min', any(wildchar('$'))), char('.'), char('.'), capture('max', any(wildchar('$')))), result: LogicToken.of('asterlang:count', function(t) {
            const fix = (n: string | number): number | undefined => Number.isNaN(n=+(n || NaN)) ? void 0 : n;
            const min = fix(getCapturedData(t, 'min').getRawValue());
            const max = fix(getCapturedData(t, 'min').getRawValue());

            return ASTER.TokenMatchers.count(getCapturedData(t,'value').reduce(), {min, max});
        }), recursive: true}, // #logic 3..5

        // \@/[a-z_]+/
        {pattern: seq(char('@'), capture('what', IDENT)), result: LogicToken.of('asterlang:tk', function(t) {
            return ASTER.TokenMatchers.tk(getCapturedData(t, 'what').getRawValue());
        })}, // @name
        // \#/[a-z_]+/
        {pattern: seq(char('#'), capture('what', IDENT)), result: LogicToken.of('asterlang:is', function(t) {
            return ASTER.TokenMatchers.is(getCapturedData(t, 'what').getRawValue());
        })}, // #tag

        // \!#logic
        {pattern: seq(char('!'), capture('value',is('logic'))), result: LogicToken.of('asterlang:not', function(t) {
            const value = getCapturedData(t, 'value').reduce();
            return ASTER.TokenMatchers.not({matches(...args: any[]): -1 | 0 | 1 {
                // @ts-expect-error
                const t = value.matches(...args);
                if(t < -1 || t > 1) throw new SyntaxError('Only results of -1, 0, or 1 can be negated');
                return t as -1 | 0 | 1;
            }});
        }), recursive: true}, // !pattern

        // #logic \|\| #logic
        {pattern: seq(capture('lhs', is('logic')), char('|'), char('|'), capture('rhs',is('logic'))), result: LogicToken.of('asterlang:or', function(t) {
            return ASTER.TokenMatchers.or(getCapturedData(t, 'lhs').reduce(), getCapturedData(t, 'rhs').reduce());
        }), recursive: true},// LHS || RHS
        // #logic \&\& #logic
        {pattern: seq(capture('lhs', is('logic')), char('&'), char('&'), capture('rhs', is('logic'))), result: LogicToken.of('asterlang:and', function(t) {
            return ASTER.TokenMatchers.and(getCapturedData(t, 'lhs').reduce(), getCapturedData(t, 'rhs').reduce());
        }), recursive: true},// LHS && RHS

        // \>\>#logic
        {pattern: seq(char('>'), char('>'), capture('value', is('logic'))), result: LogicToken.of('asterlang:next', function(t) {
            return ASTER.TokenMatchers.next(getCapturedData(t, 'value').reduce());
        }), recursive: true},
        // \<\<#logic
        {pattern: seq(char('<'), char('<'), capture('value', is('logic'))), result: LogicToken.of('asterlang:prev', function(t) {
            return ASTER.TokenMatchers.prev(getCapturedData(t, 'value').reduce());
        }), recursive: true},

        // \[ /[a-z0-9_]+/i \= (@string || $..) \]
        {pattern: seq(char('['), capture('what', IDENT), char('='), capture('value', or(tk('asterlang:string'), count(wildchar('$')))), char(']')), result: LogicToken.of('asterlang:propeq', function(t) {
            const valueToken = getCapturedData(t, 'value');
            let value: string | number;
            if(valueToken.tokens[0].getName() === 'asterlang:string') {
                value = getCapturedData(valueToken.tokens[0], 'data').getRawValue();
            } else {
                value = +valueToken.getRawValue();
            }
            
            return ASTER.TokenMatchers.propeq(getCapturedData(t, 'what').getRawValue(), value);
        })}, // [prop=value]
        // \[ /[a-z0-9_]+/i \]
        {pattern: seq(char('['), capture('what', IDENT), char(']')), result: LogicToken.of('asterlang:hasprop', function(t) {
            return ASTER.TokenMatchers.hasprop(getCapturedData(t, 'what').getRawValue());
        })}, // [prop]

        // #logic #logic+
        {pattern: seq(is('logic'), count(is('logic'))), result: LogicToken.of('asterlang:seq', function(t) {
            return ASTER.TokenMatchers.seq(...t.getChildren().map(c=>(c as LogicToken).reduce()));
        }), recursive: true}, // pattern1 pattern2
        /**/
    ];
    export function expr(text: string): ASTER.TokenPattern {
        const tokens = ASTER.tokenize(text, GRAMMAR);
        let currentToken: ASTER.Token | undefined;
        let pos = 0;

        function expect(pattern: ASTER.SingleTokenPattern) {
            const t = tokens.shift();
            if(t === undefined)
                throw new Error(`Unexpected EOF at position ${pos + (currentToken ? currentToken.getLength() : 0)}`);
            if(pattern.matches([t], new Map(), []) < 0)
                throw new Error(`Unexpected token ${t.getName()} "${t.getRawValue()}" at position ${t.getStart()}.`);
            currentToken = t;
            pos = currentToken.getStart();
        }

        expect(tk('SOF'));
        expect(is('logic'));
        const result = (currentToken as LogicToken).reduce();
        expect(tk('EOF'));

        return result;
    }
}

namespace DecoratorFactory {
    function isDecoratorContext(arg: unknown): arg is DecoratorContext {
        return typeof arg === 'object' && arg !== null && ['kind','name'].every(key=>Object.hasOwn(arg,key))
    }
    function isFactoryCall(...args: unknown[]) {
        return !((typeof args[0] === 'function' || typeof args[0] === 'undefined') && isDecoratorContext(args[1])); 
    }
    export function invokeDefault(value: Class | Function, context: DecoratorContext, ...args: unknown[]) {
        return context.kind === 'class' ? new (value as DecoratorFactory.Class)(...args) : (value as DecoratorFactory.Function)(...args)
    }
    export function decorator<Context extends DecoratorContext, Args extends Array<unknown>,Value,Return extends Function | void>(f: (value: Value, context: Context, ...args: Partial<Args>) => Return) {
        function decorate(...args: Partial<Args>): (value: Value, context: Context)=>Return;
        function decorate(value: Value, context: Context): Return;
        function decorate(...args: Partial<Args> | [Value, Context]) {
            if(isFactoryCall(...args)) {
                return (value: Value, context: Context) => f(value, context, ...args as Args);
            } else {
                const [value, context] = args as [Value, Context];
                return f(value, context, ...([] as unknown[] as Args));
            }
        }
        return decorate;
    }
    export type Class<A extends Array<unknown> = any[], R = any> = new (...args: A) => R;
    export type Function<A extends Array<unknown> = any[], R = any> = (...args: A) => R
}

namespace ASTERUtils {
    const asterConfig = Symbol('asterConfig');

    type TokenMethodConfig = {readonly name: string, tags: string[], syntax: string | null, recursive: boolean};

    function getRegistryEntry(value: object, context: DecoratorContext): TokenMethodConfig {
        if(context.kind !== 'method' || typeof context.name !== 'string')
          throw new TypeError('AsterLang annotations can only be used on class methods with string names');
        return (value as any)[asterConfig] ??= {name: context.name, tags: [], syntax: null, recursive: false};
    }

    export const tags = DecoratorFactory.decorator((value: object, context, tags: string[] = []) => {
        const entry = getRegistryEntry(value, context);
        entry.tags.push(...tags.filter(t => t));
    });

    export const tag = DecoratorFactory.decorator((value: object, context, tag?: string | TemplateStringsArray, values?: any[]) => {
        const entry = getRegistryEntry(value, context);
        if(tag) {
            if(Array.isArray(tag)) {
                entry.tags.push(String.raw(tag as TemplateStringsArray, values));
            } else {
                entry.tags.push(tag as string);
            }
        }
    });

    export const syntax = DecoratorFactory.decorator((value: object, context, syntax?: string | TemplateStringsArray, values?: any[]) => {
        const entry = getRegistryEntry(value, context);
        if(syntax) {
            if(Array.isArray(syntax)) {
                entry.syntax = String.raw(syntax as TemplateStringsArray, values);
            } else {
                entry.syntax = syntax as string;
            }
        }
    });

    export const recursive = DecoratorFactory.decorator((value: object, context, recursive: boolean = true) => {
        const entry = getRegistryEntry(value, context);
        entry.recursive = recursive;
    });

    export interface Reducable<State, Target> {
        reduce(state: State): Target;
    }

    export class Parser<Target, State extends object> {
        private readonly DynamicToken = class DynamicToken extends ASTER.Token {
            private constructor(name: string, position: ASTER.TokenPosition, args: ASTER.TokenArgs, private readonly reducer: (t: DynamicToken, state: State) => Target) {
                super(name, position, args);
            }
            static of(name: string, tags: string[], reducer: (t: DynamicToken, state: State) => Target) {
                return function(matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
                    return new DynamicToken(name, position, {children: matches, props: captures, tags}, reducer);
                }
            }
            reduce(state: State): Target {
                return this.reducer(this, state);
            }
        }
        private readonly tokenizers: ASTER.Tokenizer[];
        constructor(grammar: object) {
            const proto = Object.getPrototypeOf(grammar);
            this.tokenizers = Object.getOwnPropertyNames(proto).filter(name => name !== 'constructor').flatMap(name => {
                const config: TokenMethodConfig = Reflect.get(proto[name], asterConfig);
                if(!config || !config.syntax)
                    return [];

                const pattern = ASTERLang.expr(config.syntax);

                if(pattern.matches([], new Map(), []) !== -1)
                    throw new Error(`Pattern for ${name} ('${config.syntax}') matches empty space`)

                return [{
                    pattern,
                    result: this.DynamicToken.of(config.name, config.tags, proto[name]),
                    recursive: config.recursive
                }]
            });

        }
        parse(text: string, initialState: State): Target {
            const tokens = ASTER.tokenize(text, this.tokenizers);
            const [SOF, t, EOF] = tokens;
            return (t).reduce()
        }
    }
}

console.clear()
console.log(Date.now())

const {syntax,tag,tags,recursive,Parser} = ASTERUtils;
const r = String.raw

type State = {}

class MyGrammar {
  @syntax `/[A-Z_][A-Z0-9_]*/`
  ident() {}

  @syntax `@ident ~+ \: ~+ @ident`
  type_annotation() {}

  @syntax(r`$..`)
  int(t: ASTER.Token, s: State) {}
  
  @syntax(r`"const"`)
  const_kwd() {}

  @syntax `@const_kwd ~.. @type_annotation ~+ \= ~+ @int \;`
  const_expr() {}
}

class CalculatorGrammar {
  @syntax `value: ($..)`
  @tag `expr`
  int(token: ASTER.Token) {
    return +token.getRawValue()
  }

  @syntax `value: (@int\.@int)`
  @tag `expr`
  decimal(token: ASTER.Token) {
    return +token.getRawValue()
  }

  @syntax `\( (value: #expr) \)`
  @tag `expr`
  @recursive
  group(token: ASTER.Token) {
    return token.getProp('value')[0].reduce(); 
  }

  @syntax `(lhs: #expr) ~+ \^ ~+ (rhs: #expr)`
  @tag `expr`
  @recursive
  pow(token: ASTER.Token) {
    return token.getProp('lhs')[0].reduce() ** token.getProp('rhs')[0].reduce(); 
  }

  @syntax `(lhs: #expr) ~+ (op: (\* || \/)) ~+ (rhs: #expr)`
  @tag `expr`
  @recursive
  multdiv(token: ASTER.Token) {
    if(token.getProp('op')[0].getRawValue() === '/')
      return token.getProp('lhs')[0].reduce() / token.getProp('rhs')[0].reduce(); 
    else
      return token.getProp('lhs')[0].reduce() * token.getProp('rhs')[0].reduce();  
  }

  @syntax `(lhs: #expr) ~+ (op: (\+ || \-)) ~+ (rhs: #expr)`
  @tag `expr`
  @recursive
  addsub(token: ASTER.Token) {
    if(token.getProp('op')[0].getRawValue() === '-')
      return token.getProp('lhs')[0].reduce() - token.getProp('rhs')[0].reduce(); 
    else
      return token.getProp('lhs')[0].reduce() + token.getProp('rhs')[0].reduce(); 
  }

}

console.log;

const parser = new Parser<number,State>(new CalculatorGrammar());
console.log('built parser')
//console.log(ASTERLang.expr(String.raw`\a+`).matches([],new Map(), []) <= 0)
// console.log(parser.parse('const A: L12 = 128;', {}))
console.log(parser.parse('1 * 1.5 + 2-1', {}))
