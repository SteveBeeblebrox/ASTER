///#pragma once

namespace ASTER {
	namespace Util {
		export function splitGraphemes(text: string) {
			return Array.from(new Intl.Segmenter("en", { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
		}
	}
	export type TokenMatcherCaptures = Map<string, Token[] | null>;
	export type TokenPosition = { start: number, length: number };
	export type TokenPattern = { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): number }
	export type SingleTokenPattern = TokenPattern & { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1 | 0 | 1 }
	export type NonConsumingTokenPattern = TokenPattern & { matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1 | 0 }
	export type TokenArgs = { tags?: string | string[], props?: object | Map<string, any>, children?: Token[] }
	export type Tokenizer = {
		pattern: TokenPattern,
		recursive?: boolean
		result: string | ((matches: Token[], position: TokenPosition, captures: TokenMatcherCaptures) => Token | Token[])
	}

	export class Token {
		private readonly tags: string[];
		private readonly properties: Map<string, any>;
		private readonly children?: Token[];
		constructor(private readonly name: string, private readonly position: TokenPosition, { tags = [], props = {}, children = undefined }: TokenArgs = {}) {
			if (typeof tags === 'string') this.tags = tags.split(/,|\s+/g).filter(x => x);
			else this.tags = [...tags];

			if (props instanceof Map) this.properties = props;
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
		constructor(private readonly value: string, position: TokenPosition, { tags, props }: Omit<TokenArgs, 'children'> = {}) {
			super('CHAR', position, { tags, props })
		}
		public getValue() {
			return this.value;
		}
		public getRawValue() {
			return this.getValue();
		}
	}
	class SpecialToken extends Token {
		constructor(name: string, position: TokenPosition, { tags, props }: Omit<TokenArgs, 'children'> = {}) {
			super(name, position, { tags, props })
		}
		public getRawValue() {
			return '';
		}
	}
	export function tokenize(text: string, tokenizers: Tokenizer[]): Token[] {
		// Split code points
		const tokens = [new SpecialToken('SOF', { start: -1, length: 0 }), ...[...text].map((value, i) => new CharToken(value, { start: i, length: value.length })), new SpecialToken('EOF', { start: text.length, length: 0 })];

		function applyTokenizer(tokenizer: Tokenizer): boolean {
			let applied = false;
			for (let i = 0; i < tokens.length; i++) {
				const captures = new Map();
				const matches = tokenizer.pattern.matches(tokens.slice(i), captures, tokens.slice(0, i));
				if (matches !== -1) {
					const matchedTokens = tokens.slice(i, i + matches);
					const position = { start: (matchedTokens[0] ?? tokens[i]).getStart(), length: matchedTokens.reduce((sum, token) => sum + token.getLength(), 0) };
					const newTokens = typeof tokenizer.result === 'string' ? new Token(tokenizer.result, position, { children: matchedTokens, props: captures }) : tokenizer.result(matchedTokens, position, captures);
					tokens.splice(i, matches, ...(Array.isArray(newTokens) ? newTokens : [newTokens]));
					applied ||= true;
					i--;
				}
			}
			return applied;
		}

		for (const tokenizer of tokenizers) {
			applyTokenizer(tokenizer);
		}

		const recursiveTokenizers = tokenizers.filter(tokenizer => tokenizer.recursive);

		let mutated;
		do {
			mutated = false;
			for (const tokenizer of recursiveTokenizers) mutated ||= applyTokenizer(tokenizer);
		} while (mutated);

		return tokens;
	}
	export namespace PatternBuilders {
		function matchSingle(matched: boolean): -1 | 1 {
			return 1 - 2 * +!matched as (-1 | 1);
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
		export function raweq(value: string): SingleTokenPattern {
			return {
				matches([token]) {
					return matchSingle(token && token.getRawValue() === value);
				}
			}
		}
		export function str(value: string): TokenPattern {
			return {
				matches(tokens) {
					for (let i = 0; i < value.length; i++) {
						const token = tokens[i];
						if (!(token instanceof ASTER.CharToken) || token.getValue() !== value[i])
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
					if (matches !== -1) captures.set(name, tokens.slice(0, matches));
					else captures.set(name, null);
					return matches;
				}
			}
		}
		export function wildchar(pattern: '*' | '~' | '$' = '*'): SingleTokenPattern {
			const matches = (function (): (tokens: Token[]) => -1 | 1 {
				switch (pattern) {
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
				matches(tokens, captures, previousTokens) {
					let matches = 0;
					for (let i = 0; i < matchers.length; i++) {
						const c = matchers[i].matches(tokens.slice(matches), captures, [...previousTokens, ...tokens.slice(0, matches)]);
						if (c !== -1) matches += c;
						else return -1;
					}
					return matches;
				}
			}
		}

		export function count(matcher: TokenPattern, { min = 1, max = -1 } = {}): TokenPattern {
			return {
				matches(tokens, captures, previousTokens) {
					let numCountMatches = 0, matchedTokenCount = 0;
					while (max === -1 || numCountMatches <= max) {
						const matches = matcher.matches(tokens.slice(matchedTokenCount), captures, [...previousTokens, ...tokens.slice(0, matchedTokenCount)]);
						if (matches === -1)
							break;
						matchedTokenCount += matches;
						numCountMatches++
					}
					if (numCountMatches >= min) return matchedTokenCount;
					else if (min === 0) return 0;
					return -1;
				}
			}
		}

		export function any(matcher: TokenPattern): TokenPattern {
			return count(matcher, { min: 0 });
		}

		export function optional(matcher: TokenPattern): TokenPattern {
			return count(matcher, { min: 0, max: 1 });
		}

		export function or(...matchers: TokenPattern[]): TokenPattern
		export function or(...matchers: SingleTokenPattern[]): SingleTokenPattern
		export function or(...matchers: TokenPattern[]): TokenPattern {
			return {
				matches(tokens, captures, previousTokens) {
					for (const matcher of matchers) {
						const matches = matcher.matches(tokens, captures, previousTokens);
						if (matches !== -1) return matches;
					}
					return -1;
				}
			}
		}

		export function not(matcher: SingleTokenPattern): SingleTokenPattern {
			return {
				matches([token], captures, previousTokens) {
					if (!token) return -1;
					const i = matcher.matches([token], captures, previousTokens)
					return i * -1 + -1 * +!i as (-1 | 0 | 1);
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
					return Math.min(...matchers.map(matcher => matcher.matches(tokens, captures, previousTokens)));
				}
			}
		}

		export function re(pattern: string, { ignoreCase = false } = {}): TokenPattern {
			return {
				matches(tokens, captures, previousTokens) {
					let nextStr = '';
					for (const token of tokens) {
						if (token instanceof CharToken)
							nextStr += token.getValue();
						else
							break;
					}
					let startOffset = 0;
					for (const token of previousTokens.reverse()) {
						if (token instanceof CharToken) {
							nextStr = token.getValue() + nextStr;
							startOffset++;
						} else {
							break;
						}
					}
					const regex = new RegExp(pattern, 'gud' + 'i'.repeat(+ignoreCase));
					regex.lastIndex = startOffset;
					const matches = regex.exec(nextStr);
					if (matches?.indices?.[0]?.[0] === startOffset) {
						// @ts-expect-error
						Object.entries(matches.groups ?? {}).forEach(([key, value]) => captures.set(key, [...value].map(c => new CharToken(c, { start: tokens[0].getStart() + matches.indices.groups[key][0], length: 1 }))));
						return regex.lastIndex - startOffset;
					}
					return -1;
				}
			}
		}
		export function lambda(f: (token: Token) => boolean): SingleTokenPattern {
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