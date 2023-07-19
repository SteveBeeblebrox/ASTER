console.clear()

const _checkloop = (function() {
  let n = 0;
  return (contents?: any) => {if(n++>15550) throw contents ?? 'Infinite loop terminated.'}
})();

namespace ASTER {
  namespace Util {
    export function splitGraphemes(text: string) {
      return Array.from(new Intl.Segmenter("en", {granularity: 'grapheme'}).segment(text), ({segment}) => segment);
    }
  }
  type TokenMatcherCaptures = Map<string, Token[]|null>;
  export type TokenPosition = {start: number, length: number};
  export type TokenPattern = { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): number }
  export type SingleTokenPattern = TokenPattern & { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1|0|1 }
  export type NonConsumingTokenPattern = TokenPattern & { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1|0 }
  export type Tokenizer = {
    pattern: TokenPattern,
    recursive?: boolean
    result: string | ((matches: Token[], position: TokenPosition, captures: TokenMatcherCaptures)=> Token | Token[])
  }

  type TokenArgs = {tags?: string | string[], props?: object | Map<string,any>, children?: Token[]}
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
  }
  export class CharToken extends Token {
    constructor(private readonly value: string, position: TokenPosition, {tags, props}: Omit<TokenArgs, 'children'> = {}) {
      super('char', position, {tags, props})
    }
    public getValue() {
      return this.value;
    }
  }
  class SpecialToken extends Token {
    constructor(name: string, position: TokenPosition, {tags, props}: Omit<TokenArgs, 'children'> = {}) {
      super('aster:'+name, position, {tags, props})
    }
  }
  export function tokenize(text: string, tokenizers: Tokenizer[]): Token[] {
    // Split code points
    const tokens = [new SpecialToken('start', {start: -1, length: 0}), ...[...text].map((value,i) => new CharToken(value, {start: i, length: value.length})),new SpecialToken('eof', {start: text.length, length: 0})];

    function applyTokenizer(tokenizer: Tokenizer): boolean {
      let applied = false;
      for(let i = 0; i < tokens.length; i++) {
        _checkloop('Infinite loop applying tokenizer');
        const captures = new Map();
        const matches = tokenizer.pattern.matches(tokens.slice(i),captures,tokens.slice(0,i));
        if(matches !== -1) {
          const matchedTokens = tokens.slice(i,i+matches);
          const position = {start: (matchedTokens[0]??tokens[i]).getStart(),length:matchedTokens.reduce((sum,token)=>sum+token.getLength(),0)};
          const newTokens = typeof tokenizer.result === 'string' ? new Token(tokenizer.result,position,{children:matchedTokens}) : tokenizer.result(matchedTokens, position, captures);
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
      _checkloop()
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
          return matchSingle(token.getName() === value)
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
    export function wildchar(pattern: '*' | 'ws'|'d' = '*'): SingleTokenPattern {
      const matches = (function(): (tokens: Token[])=> -1 | 1 {
        switch(pattern) {
          case '*': return ([token]) => matchSingle(token instanceof CharToken);
          case 'ws': return ([token]) => matchSingle(token instanceof CharToken && /^\s$/.test(token?.getValue?.()));
          case 'd': return ([token]) => matchSingle(token instanceof CharToken && /\d$/.test(token?.getValue?.()));
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
      if(min === max) {
        return {
          matches(tokens,captures,previousTokens) {
            let matches = 0;
            for(let i = 0; i < min; i++) {
              const c = matcher.matches(tokens.slice(matches),captures,[...previousTokens, ...tokens.slice(0, matches)]);
              if(c !== -1) matches+=c;
              else return -1;
            }
            return matches;
          }
        }
      }

      return {
        matches(tokens,captures,previousTokens) {
          let numCountMatches = 0, matchedTokenCount = 0;
          while(max === -1 || numCountMatches <= max) {
            _checkloop()
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

const {seq, char,capture,wildchar,count,tk,or,and,prev,next,not,hasprop,propeq,re,is,lambda,any} = ASTER.TokenMatchers;
//seq a + b + c
//char
//capture (?<name>...)
//wildchar
//count
//tk
//or
//and
//prev
//next
//not
//hasprop
//propeq
//re


const raw = String.raw;
const WS = count(wildchar('ws'))
const IDENT = re(raw`[a-z0-9_]+`, {ignoreCase: true})
function LogicToken(name: string) {
    return function(matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
        return new ASTER.Token(name, position, {children: matches, props: captures, tags: 'logic'});
    }
}

console.log(ASTER.tokenize(raw`
#foo&&#bar&& #wow
`, [
    // \\\"
    {pattern: seq(char('\\'), char('"')), result: 'asterlang:escaped-quote'},
    // \" *0.. \"
    {pattern: seq(char('"'), count(wildchar(),{min:0}), char('"')), result: 'asterlang:string'},

    // @asterlang:escaped-quote
    {pattern: tk('escaped-quote'), result: (_,position) => new ASTER.CharToken('"', position)},

    {pattern: wildchar('ws'), result: ()=>[]},

    // \( #logic \)
    {pattern: seq(char('('), is('logic'), char(')')), result: LogicToken('asterlang:group'), recursive: true}, // (pattern)

    // 
    {pattern: seq(is('logic'), count(is('logic'))), result: LogicToken('asterlang:seq'), recursive: true}, // pattern1 pattern2

    // \\*
    {pattern: seq(char('\\'), wildchar()), result: LogicToken('asterlang:char')}, // \c
    // \*
    {pattern: char('*'), result: LogicToken('asterlang:wildchar-any')}, // *
    // \$
    {pattern: char('$'), result: LogicToken('asterlang:wildchar-digit')}, // $

    // /[a-z0-9_]+/i \: #logic
    {pattern: seq(IDENT, char(':'), is('logic')), result: LogicToken('asterlang:capture'), recursive: true}, //name: pattern

    // #logic $.. \.\. $..
    {pattern: seq(is('logic'), count(wildchar('d'), {min: 0}), char('.'), char('.'), count(wildchar('d'), {min: 0})), result: LogicToken('asterlang:count'), recursive: true}, // #logic 3..5

    // \@/[a-z_]+/
    {pattern: seq(char('@'), IDENT), result: LogicToken('asterlang:tk')}, // @name
    // \#/[a-z_]+/
    {pattern: seq(char('#'), IDENT), result: LogicToken('asterlang:is')}, // #tag

    // \!#logic
    {pattern: seq(char('!'), is('logic')), result: LogicToken('asterlang:not'), recursive: true}, // !pattern

    // #logic \|\| #logic
    {pattern: seq(is('logic'), char('|'), char('|'), is('logic')), result: LogicToken('asterlang:or'), recursive: true},// LHS || RHS
    // #logic \&\& #logic
    {pattern: seq(is('logic'), char('&'), char('&'), is('logic')), result: LogicToken('asterlang:and'), recursive: true},// LHS && RHS

    // \>\>#logic
    {pattern: seq(char('>'), char('>'), is('logic')), result: LogicToken('asterlang:next'), recursive: true},
    // \<\<#logic
    {pattern: seq(char('<'), char('<'), is('logic')), result: LogicToken('asterlang:prev'), recursive: true},

    // \[ /[a-z0-9_]+/i \= (@string || $..) \]
    {pattern: seq(char('['), IDENT, char('='), or(tk('asterlang:string'), count(wildchar('d'))), char(']')), result: LogicToken('asterlang:propeq')}, // [prop=value]
    // \[ /[a-z0-9_]+/i \]
    {pattern: seq(char('['), IDENT, char(']')), result: 'asterlang:hasprop'}, // [prop]

    // \/ *.. <<!\\ \/ \i..1
    {pattern: seq(char('/'), count(wildchar()), prev(not(char('\\'))), char('/'), count(char('i'), {min: 0, max: 1})), result: LogicToken('asterlang:re')} // /pattern/i

]))
// tokenizer should track position in origional string for error messages later on
const tokenizers: ASTER.Tokenizer[] = [
  //{matcher: seq(char('\\'), capture('value',wildchar())), builder: {build(_,captures) {return {name: 'escapedchar',value:(captures.get('value')![0] as CharToken).value}}}},
  // {pattern: seq(or(char('F'),char('f')),char('a'),char('n'),char('c'),char('y')), buildTokens: 'fancy-kwd'},
  // {pattern: count(char('.'), {min:3,max:5}), buildTokens(tokens,position) {return new ASTER.Token('ellipses', position, {props: {count: tokens.length}})}},
  // {pattern: seq(tk('fancy-kwd'),tk('ellipses')),buildTokens: 'fancy-kwd-annnnd?'},
  // {pattern: seq(char('('),count(not(or(char('('),char(')'))),{min:0}),char(')')), buildTokens: 'block', recursive: true},
  // {pattern: seq(count(char('a')),char('h')), buildTokens: 'shout'},
  // {pattern: seq(count(seq(char('l'),char('o'))),char('l')), buildTokens:'lololol'}//broken
  // {pattern: re(raw `\s+`), buildTokens: 'aster:boundry'},
  // {pattern: seq(or(tk('aster:boundry'),tk('aster:start')),re('[fF](?<v>a)ncy')), buildTokens(tokens,position,captures) {
  //   //console.log(captures)
  //   return new ASTER.Token('foo', position);
  // }}
  //{pattern: seq(prev(char(' ')), re('fancy', {ignoreCase: true})), buildTokens: 'fancy-kwd'}
  {pattern: re('(?<= )fancy', {ignoreCase: true}), result: 'fancy-kwd'}
]
//console.log(ASTER.tokenize(String.raw`afoo fancy`, tokenizers))


namespace SHML {
    type Captures = Map<string, ASTER.Token[]|null>;
    type DetailBuilderFunction<T> = (matches: ASTER.Token[], captures: Captures, position: ASTER.TokenPosition)=>T
    export class TransformToken extends ASTER.Token {
        public readonly captures: Captures;
        public readonly matches: ASTER.Token[]
        private constructor(name: string, data: {tags?: string | string[], props?: Map<string,any>, children?: ASTER.Token[], captures: Captures, matches: ASTER.Token[], position: ASTER.TokenPosition}, public readonly toHTML: (this: TransformToken)=>Node, public readonly toString: (this: TransformToken)=>string) {
            super('shml:'+name,data.position,data);
            this.captures = data.captures;
            this.matches = data.matches;
        }

        static create(name: string, pattern: ASTER.TokenPattern, {toString=()=>'', toHTML=()=>new Text('')}: {toString?: ()=>string, toHTML?: ()=>Node} = {}, {tags=()=>[],props=()=>new Map()}: {tags?: string | DetailBuilderFunction<string[]|string>,props?: object | Map<string,any> | DetailBuilderFunction<Map<string,any>>} = {}) {
            return {
                pattern,
                buildTokens(matches: ASTER.Token[], position: ASTER.TokenPosition, captures: Captures): ASTER.Token | ASTER.Token[] {
                    return new TransformToken(name, {position, matches, captures, tags: typeof tags === 'string' ? tags : tags(matches, captures, position), props: props instanceof Map ? props : typeof props === 'object' ? new Map(Object.entries(props)) : props(matches, captures, position)}, toHTML, toString)
                }
            }
        }
    }
}

// todo improve recursive moving down. for HTML, return Text instead of strings to prevent xss. check if not TransformToken if is Char then do the Text else throw error, something didn't match right
SHML.TransformToken.create('italic', seq(char('*'), capture('CONTENTS', count(not(char('*')))), char('*')), {
    toHTML(this: SHML.TransformToken) {
        return Object.assign(document.createElement('em'), {children: this.captures.get('CONTENTS')!.map(o=>o instanceof SHML.TransformToken ? o.toHTML() : o.toString())
    }
) }}, {tags: 'inline'})

console.clear()

console.log(ASTER.tokenize(raw`
#define foo

foo


"fo\"o"

(())
${'`${foo}`'}

// hi()

/*
// a

wow
*/


(foo,bar)

#define strc(x) #x



`, [
    // \\\"
    {pattern: seq(char('\\'),capture('value',wildchar('*'))), result: 'echar'},
    {pattern: seq(char('"'),any(or(tk('echar'),and(wildchar('*'),not(char('"')),not(char('\n'))))),char('"')), result: 'string'},
    {pattern: seq(char('\''),any(or(tk('echar'),and(wildchar('*'),not(char('\'')),not(char('\n'))))),char('\'')), result: 'string'},

    {pattern: re(String.raw`[a-zA-Z_$][a-zA-Z_$0-9]*`), result: 'ident'},
    {pattern: seq(char('#'),any(tk('whatever')),tk('ident')), result: 'hashident'},

    {pattern: seq(count(char('/'),{min:2,max:2}),count(not(char('\n')),{min:0})), result: 'comment'},
    {pattern: seq(char('*'),char('/')), result: 'mcommentend'},
    {pattern: seq(char('/'),char('*'), any(not(tk('mcommentend'))), tk('mcommentend')), result: 'mcomment'},
    {pattern: tk('mcommentend'), result: ([tk]) => tk.getChildren()},

    {pattern: char('\n'), result: 'newline'},

    {pattern: or(wildchar('ws'), tk('mcomment'), tk('comment')), result: 'whatever'},

    {pattern: seq(char('('), any(tk('whatever')), char(')')), result: 'emptyparens'},
    {pattern: seq(char('('), any(tk('whatever')), tk('ident'), any(seq(any(tk('whatever')), char(','), any(tk('whatever')), tk('ident'))), any(tk('whatever')), char(')')), result: 'arglist', recursive: true},

    {pattern: seq(char('('),any(and(not(char('(')),not(char(')')))),char(')')), result: 'parens', recursive: true},
    {pattern: seq(char('['),any(and(not(char('[')),not(char(']')))),char(']')), result: 'braces', recursive: true},
    {pattern: seq(char('{'),any(and(not(char('{')),not(char('}')))),char('}')), result: 'curls', recursive: true},



    {pattern: seq(lambda(f => f.getName()=='ident'&&(f.getChildren()[0] as ASTER.CharToken).getValue() == '$'), tk('curls')), result: 'strinterp', recursive: true},
    {pattern: seq(char('`'),count(not(char('`')),{min: 0}),char('`')), result: 'mstring', recursive: true},

    


    {pattern: seq(lambda(t => t.getName() === 'hashident' && (t.getChildren()[1].getChildren() as ASTER.CharToken[]).map(t=>t.getValue()).join('') == 'define'), count(tk('whatever')), tk('ident'), any(tk('whatever')), any(or(tk('emptyparens'),tk('arglist'))), any(tk('whatever')), any(not(tk('newline')))), result: 'define'},
]))


// console.log(ASTER.tokenize(raw`
// aaahhhh
// `, [

//   {pattern: char('a'), result: 'a'},
//   {pattern: char('h'), result: 'h'},
//   {pattern: seq(count(tk('a')),count(tk('h'))), result: 'ahhhh'}
// ]))
