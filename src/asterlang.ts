///#pragma once
///#include "aster.ts"

namespace ASTERLang {
	const { seq, char, capture, wildchar, count, tk, or, and, prev, next, not, hasprop, propeq, re, is, lambda, any, optional } = ASTER.PatternBuilders;
	const IDENT = re(String.raw`(?:[a-z][a-z0-9_\-]*:)?[a-z][a-z0-9_\-]*`, { ignoreCase: true })
	type LogicTokenReducer = (t: LogicToken) => ASTER.TokenPattern;
	class LogicToken extends ASTER.Token {
		private constructor(name: string, position: ASTER.TokenPosition, args: ASTER.TokenArgs, private readonly reducer: LogicTokenReducer) {
			super(name, position, args);
		}
		static of(name: string, reducer: LogicTokenReducer) {
			return function (matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
				return new LogicToken(name, position, { children: matches, props: captures, tags: 'logic' }, reducer);
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
			return function (matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
				return new EscapedToken(name, position, { children: matches, props: captures, tags: 'escaped' });
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
		{ pattern: seq(char('\\'), char('\\')), result: EscapedToken.of('asterlang:escaped-escape') }, // \\
		// \\\"
		{ pattern: seq(char('\\'), char('"')), result: EscapedToken.of('asterlang:escaped-quote') }, // \"
		// \\\/
		{ pattern: seq(char('\\'), char('/')), result: EscapedToken.of('asterlang:escaped-slash') }, // \/
		// \\\~
		{ pattern: seq(char('\\'), wildchar('~')), result: EscapedToken.of('asterlang:escaped-ws') }, // \ 

		// \" (* || @asterlang:escaped-quote || @asterlang:escaped-escape)+ \"
		{
			pattern: seq(char('"'), capture('data', any(or(not(char('"')), is('escaped')))), char('"')), result: LogicToken.of('asterlang:string', function (t) {
				return ASTER.PatternBuilders.str(getCapturedData(t, 'data').getRawValue())
			})
		},

		// \/ (* || #escaped).. \/ \i?
		{
			pattern: seq(char('/'), capture('value', count(or(not(char('/')), is('escaped')))), char('/'), capture('i', optional(char('i')))), result: LogicToken.of('asterlang:re', function (t) {
				const text = (t.getProp('value') as ASTER.Token[]).map(function (t) {
					return t instanceof EscapedToken ? '\\' + t.getRawValue() : t.getRawValue();
				}).join('')
				return ASTER.PatternBuilders.re(text, { ignoreCase: getCapturedData(t, 'i').getRawValue() === 'i' });
			})
		}, // /pattern/i

		// ~
		{ pattern: wildchar('~'), result: () => [] },

		// #escaped
		{
			pattern: is('escaped'), result: ([t], position) => [
				new ASTER.CharToken('\\', { start: position.start, length: 1 }),
				new ASTER.CharToken((t as EscapedToken).getRawValue(), { start: position.length + 1, length: 1 })
			]
		},

		// \\*
		{
			pattern: seq(char('\\'), capture('what', wildchar())), result: LogicToken.of('asterlang:char', function (t) {
				return ASTER.PatternBuilders.char(getCapturedData(t, 'what').getRawValue())
			})
		}, // \c

		// \*
		{
			pattern: char('*'), result: LogicToken.of('asterlang:wildchar-any', function () {
				return ASTER.PatternBuilders.wildchar('*');
			})
		}, // *
		// \$
		{
			pattern: char('$'), result: LogicToken.of('asterlang:wildchar-digit', function () {
				return ASTER.PatternBuilders.wildchar('$');
			})
		}, // $
		// \~
		{
			pattern: char('~'), result: LogicToken.of('asterlang:wildchar-digit', function () {
				return ASTER.PatternBuilders.wildchar('~');
			})
		}, // ~

		// \( #logic \)
		{
			pattern: seq(char('('), capture('value', is('logic')), char(')')), result: LogicToken.of('asterlang:group', function (t) {
				return getCapturedData(t, 'value').reduce();
			}), recursive: true
		}, // (pattern)

		// #logic \+
		{
			pattern: seq(capture('value', is('logic')), char('+')), result: LogicToken.of('asterlang:any', function (t) {
				return ASTER.PatternBuilders.any(getCapturedData(t, 'value').reduce());
			}), recursive: true
		}, //#logic+

		// #logic \?
		{
			pattern: seq(capture('value', is('logic')), char('?')), result: LogicToken.of('asterlang:optional', function (t) {
				return ASTER.PatternBuilders.optional(getCapturedData(t, 'value').reduce());
			}), recursive: true
		}, //#logic?

		// #logic $+ \.\. $+
		{
			pattern: seq(capture('value', is('logic')), capture('min', any(wildchar('$'))), char('.'), char('.'), capture('max', any(wildchar('$')))), result: LogicToken.of('asterlang:count', function (t) {
				const fix = (n: string | number): number | undefined => Number.isNaN(n = +(n || NaN)) ? void 0 : n;
				const min = fix(getCapturedData(t, 'min').getRawValue());
				const max = fix(getCapturedData(t, 'min').getRawValue());

				return ASTER.PatternBuilders.count(getCapturedData(t, 'value').reduce(), { min, max });
			}), recursive: true
		}, // #logic 3..5

		// \@/[a-z_]+/
		{
			pattern: seq(char('@'), capture('what', IDENT)), result: LogicToken.of('asterlang:tk', function (t) {
				return ASTER.PatternBuilders.tk(getCapturedData(t, 'what').getRawValue());
			})
		}, // @name
		// \#/[a-z_]+/
		{
			pattern: seq(char('#'), capture('what', IDENT)), result: LogicToken.of('asterlang:is', function (t) {
				return ASTER.PatternBuilders.is(getCapturedData(t, 'what').getRawValue());
			})
		}, // #tag

		// \!#logic
		{
			pattern: seq(char('!'), capture('value', is('logic'))), result: LogicToken.of('asterlang:not', function (t) {
				const value = getCapturedData(t, 'value').reduce();
				return ASTER.PatternBuilders.not({
					matches(...args: any[]): -1 | 0 | 1 {
						// @ts-expect-error
						const t = value.matches(...args);
						if (t < -1 || t > 1) throw new SyntaxError('Only results of -1, 0, or 1 can be negated');
						return t as -1 | 0 | 1;
					}
				});
			}), recursive: true
		}, // !pattern

		// #logic \|\| #logic
		{
			pattern: seq(capture('lhs', is('logic')), char('|'), char('|'), capture('rhs', is('logic'))), result: LogicToken.of('asterlang:or', function (t) {
				return ASTER.PatternBuilders.or(getCapturedData(t, 'lhs').reduce(), getCapturedData(t, 'rhs').reduce());
			}), recursive: true
		},// LHS || RHS
		// #logic \&\& #logic
		{
			pattern: seq(capture('lhs', is('logic')), char('&'), char('&'), capture('rhs', is('logic'))), result: LogicToken.of('asterlang:and', function (t) {
				return ASTER.PatternBuilders.and(getCapturedData(t, 'lhs').reduce(), getCapturedData(t, 'rhs').reduce());
			}), recursive: true
		},// LHS && RHS

		// \>\>#logic
		{
			pattern: seq(char('>'), char('>'), capture('value', is('logic'))), result: LogicToken.of('asterlang:next', function (t) {
				return ASTER.PatternBuilders.next(getCapturedData(t, 'value').reduce());
			}), recursive: true
		},
		// \<\<#logic
		{
			pattern: seq(char('<'), char('<'), capture('value', is('logic'))), result: LogicToken.of('asterlang:prev', function (t) {
				return ASTER.PatternBuilders.prev(getCapturedData(t, 'value').reduce());
			}), recursive: true
		},

		// \[ /[a-z0-9_]+/i \= (@string || $..) \]
		{
			pattern: seq(char('['), capture('what', IDENT), char('='), capture('value', or(tk('asterlang:string'), count(wildchar('$')))), char(']')), result: LogicToken.of('asterlang:propeq', function (t) {
				const valueToken = getCapturedData(t, 'value');
				let value: string | number;
				if (valueToken.tokens[0].getName() === 'asterlang:string') {
					value = getCapturedData(valueToken.tokens[0], 'data').getRawValue();
				} else {
					value = +valueToken.getRawValue();
				}

				return ASTER.PatternBuilders.propeq(getCapturedData(t, 'what').getRawValue(), value);
			})
		}, // [prop=value]
		// \[ /[a-z0-9_]+/i \]
		{
			pattern: seq(char('['), capture('what', IDENT), char(']')), result: LogicToken.of('asterlang:hasprop', function (t) {
				return ASTER.PatternBuilders.hasprop(getCapturedData(t, 'what').getRawValue());
			})
		}, // [prop]

		// /[a-z0-9_]+/i \: #logic
		{
			pattern: seq(capture('name', IDENT), char(':'), capture('value', is('logic'))), result: LogicToken.of('asterlang:capture', function (t) {
				return ASTER.PatternBuilders.capture(getCapturedData(t, 'name').getRawValue(), getCapturedData(t, 'value').reduce());
			}), recursive: true
		}, //name: pattern

		// #logic #logic..
		{
			pattern: seq(is('logic'), count(is('logic'))), result: LogicToken.of('asterlang:seq', function (t) {
				return ASTER.PatternBuilders.seq(...t.getChildren().map(c => (c as LogicToken).reduce()));
			}), recursive: true
		}, // pattern1 pattern2
		/**/
	];
	export function expr(text: string): ASTER.TokenPattern {
		const tokens = ASTER.tokenize(text, GRAMMAR);
		let currentToken: ASTER.Token | undefined;
		let pos = 0;

		function expect(pattern: ASTER.SingleTokenPattern) {
			const t = tokens.shift();
			if (t === undefined)
				throw new Error(`Unexpected EOF at position ${pos + (currentToken ? currentToken.getLength() : 0)}`);
			if (pattern.matches([t], new Map(), []) < 0)
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