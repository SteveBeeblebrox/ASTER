console.clear()

const _checkloop = (function() {
  let n = 0;
  return (contents?: any) => {if(n++>250) throw contents ?? 'Infinite loop terminated.'}
})();

namespace ASTER {
  namespace Util {
    TODO('Split on code points not graphemes since re doesn\'t like those. use [...str]')
    export function splitGraphemes(text: string) {
      return Array.from(new Intl.Segmenter("en", {granularity: 'grapheme'}).segment(text), ({segment}) => segment);
    }
  }
  type TokenMatcherCaptures = Map<string, Token[]|null>;
  export type TokenPattern = { matches(tokens: Token[], data: TokenMatcherCaptures): number }
  export type SingleTokenPattern = TokenPattern & { matches(tokens: Token[], data: TokenMatcherCaptures): -1|0|1 }
  export type Tokenizer = {
    pattern: TokenPattern,
    recursive?: boolean
    buildTokens: string | ((matches: Token[], position: {start: number, length: number}, captures: TokenMatcherCaptures)=> Token | Token[])
  }

  type TokenArgs = {tags?: string | string[], props?: object | Map<string,any>, children?: Token[]}
  export class Token {
    private readonly tags: string[];
    private readonly properties: Map<string,any>;
    private readonly children?: Token[];
    constructor(private readonly name: string, private readonly position: {start: number, length: number}, {tags = [], props = {}, children = undefined}: TokenArgs = {}) {
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
  class CharToken extends Token {
    constructor(private readonly value: string, position: {start: number, length: number}, {tags, props}: Omit<TokenArgs, 'children'> = {}) {
      super('char', position, {tags, props})
    }
    public getValue() {
      return this.value;
    }
  }
  class SpecialToken extends Token {
    constructor(name: string, position: {start: number, length: number}, {tags, props}: Omit<TokenArgs, 'children'> = {}) {
      super('aster:'+name, position, {tags, props})
    }
  }
  export function tokenize(text: string, tokenizers: Tokenizer[]): Token[] {
    const tokens = [new SpecialToken('start', {start: -1, length: 0}), ...Util.splitGraphemes(text).map((value,i) => new CharToken(value, {start: i, length: value.length})),new SpecialToken('eof', {start: text.length, length: 0})];

    function applyTokenizer(tokenizer: Tokenizer): boolean {
      let applied = false;
      for(let i = 0; i < tokens.length; i++) {
        _checkloop();
        const captures = new Map();
        const matches = tokenizer.pattern.matches(tokens.slice(i),captures);
        if(matches !== -1) {
          const matchedTokens = tokens.slice(i,i+matches);
          
          const position = {start: (matchedTokens[0]??tokens[i]).getStart(),length:matchedTokens.reduce((sum,token)=>sum+token.getLength(),0)};
          const newTokens = typeof tokenizer.buildTokens === 'string' ? new Token(tokenizer.buildTokens,position,{children:matchedTokens}) : tokenizer.buildTokens(matchedTokens, position, captures);
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
        matches(tokens, captures) {
          const matches = matcher.matches(tokens, captures);
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
        matches(tokens,data) {
          let matches = 0;
          for(let i = 0; i < matchers.length; i++) {
            const c = matchers[i].matches(tokens.slice(matches),data);
            if(c !== -1) matches+=c;
            else return -1;
          }
          return matches;
        }
      }
    }

    export function count(matcher: TokenPattern, {min=1,max=-1} = {}): TokenPattern {
      return {
        matches(tokens,captures) {
          let numCountMatches = 0, matchedTokenCount = 0;
          while(max === -1 || numCountMatches < max) {
            const matches = matcher.matches(tokens.slice(matchedTokenCount),captures);
            if(matches === -1)
              break;
            matchedTokenCount+=matches;
            numCountMatches++
          }
          if(numCountMatches>min) return matchedTokenCount;
          else if(min === 0) return 0;
          return -1;
        }
      }
    }

    export function or(...matchers: SingleTokenPattern[]): SingleTokenPattern
    export function or(...matchers: TokenPattern[]): TokenPattern {
      return {
        matches(tokens, captures) {
          for(const matcher of matchers) {
            const matches = matcher.matches(tokens, captures);
            if(matches !== -1) return matches;
          }
          return -1;
        }
      }
    }

    export function not(matcher: SingleTokenPattern): SingleTokenPattern {
      return {
        matches([token], captures) {
          return matcher.matches([token], captures)*-1 as (-1|1);
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

    export function and(...matchers: SingleTokenPattern[]): SingleTokenPattern
    export function and(...matchers: TokenPattern[]): TokenPattern {
      return {
        matches(tokens, captures) {
          return Math.min(...matchers.map(matcher=>matcher.matches(tokens, captures)));
        }
      }
    }

    export function re(pattern: string): TokenPattern {
      return {
        matches(tokens, captures) {
          let nextStr = '';
          for(const token of tokens) {
            if(token instanceof CharToken)
              nextStr += token.getValue();
            else
              break;
          }
          const regex = new RegExp(pattern, 'gud');
          const matches = regex.exec(nextStr);
          // @ts-expect-error
          if(matches?.indices?.[0]?.[0] === 0) {
            // @ts-expect-error
            Object.entries(matches.groups ?? {}).forEach(([key,value])=>captures.set(key,Util.splitGraphemes(value).map(c=>new CharToken(c, {start: tokens[0].getStart()+matches.indices.groups[key][0], length: 1}))));
            return regex.lastIndex;
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
  }
}

function TODO() {}
TODO('Pass previous tokens to matchers for look behind')
const {seq, char,capture,wildchar,count,tk,or,not,hasprop,propeq,re} = ASTER.TokenMatchers;
const raw = String.raw;
// tokenizer should track position in origional string for error messages later on
const tokenizers: ASTER.Tokenizer[] = [
  //{matcher: seq(char('\\'), capture('value',wildchar())), builder: {build(_,captures) {return {name: 'escapedchar',value:(captures.get('value')![0] as CharToken).value}}}},
  // {pattern: seq(or(char('F'),char('f')),char('a'),char('n'),char('c'),char('y')), buildTokens: 'fancy-kwd'},
  // {pattern: count(char('.'), {min:3,max:5}), buildTokens(tokens,position) {return new ASTER.Token('ellipses', position, {props: {count: tokens.length}})}},
  // {pattern: seq(tk('fancy-kwd'),tk('ellipses')),buildTokens: 'fancy-kwd-annnnd?'},
  // {pattern: seq(char('('),count(not(or(char('('),char(')'))),{min:0}),char(')')), buildTokens: 'block', recursive: true},
  // {pattern: seq(count(char('a')),char('h')), buildTokens: 'shout'},
  // {pattern: seq(count(seq(char('l'),char('o'))),char('l')), buildTokens:'lololol'}//broken
  {pattern: re(raw `\s+`), buildTokens: 'aster:boundry'},
  {pattern: seq(or(tk('aster:boundry'),tk('aster:start')),re('[fF](?<v>a)ncy')), buildTokens(tokens,position,captures) {
    //console.log(captures)
    return new ASTER.Token('foo', position);
  }}

]
console.log(ASTER.tokenize(String.raw`fancy notfancy`, tokenizers))
