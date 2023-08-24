///#pragma once
///#include "aster.ts"
///#include "asterlang.ts"
///#include "decoratorfactory.ts"

namespace ASTERUtils {
	const asterConfig = Symbol('asterConfig');

	type TokenMethodConfig = { readonly name: string, tags: string[], syntax: string | null, recursive: boolean };

	function getRegistryEntry(value: object, context: DecoratorContext): TokenMethodConfig {
		if (context.kind !== 'method' || typeof context.name !== 'string')
			throw new TypeError('AsterUtils annotations can only be used on class methods with string names');
		return (value as any)[asterConfig] ??= { name: context.name, tags: [], syntax: null, recursive: false };
	}

	export const tags = DecoratorFactory.decorator((value: object, context, tags: string[] = []) => {
		const entry = getRegistryEntry(value, context);
		entry.tags.push(...tags.filter(t => t));
	});

	export const tag = DecoratorFactory.decorator((value: object, context, tag?: string | TemplateStringsArray, values?: any[]) => {
		const entry = getRegistryEntry(value, context);
		if (tag) {
			if (Array.isArray(tag)) {
				entry.tags.push(String.raw(tag as TemplateStringsArray, values));
			} else {
				entry.tags.push(tag as string);
			}
		}
	});

	export const syntax = DecoratorFactory.decorator((value: object, context, syntax?: string | TemplateStringsArray, values?: any[]) => {
		const entry = getRegistryEntry(value, context);
		if (syntax) {
			if (Array.isArray(syntax)) {
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

	export class Parser<GrammarType, Target, State> {
		private readonly DynamicToken = class DynamicToken extends ASTER.Token {
			private constructor(name: string, position: ASTER.TokenPosition, args: ASTER.TokenArgs, private readonly reducer: (t: DynamicToken, state: State) => Target) {
				super(name, position, args);
			}
			static of(name: string, tags: string[], reducer: (t: DynamicToken, state: State) => Target) {
				return function (matches: ASTER.Token[] | undefined, position: ASTER.TokenPosition, captures: Map<string, ASTER.Token[] | null>) {
					return new DynamicToken(name, position, { children: matches, props: captures, tags }, reducer);
				}
			}
			reduce(state: State): Target {
				return this.reducer(this, state);
			}
		}
		private readonly tokenizers: ASTER.Tokenizer[];
		constructor(grammar: GrammarType & { [k in Exclude<keyof GrammarType, `_${string}`>]: (token: ASTER.Token, state: State) => Target }) {
			const proto = Object.getPrototypeOf(grammar);
			this.tokenizers = Object.getOwnPropertyNames(proto).filter(name => name !== 'constructor' && !name.startsWith('_')).flatMap(name => {
				const config: TokenMethodConfig = Reflect.get(proto[name], asterConfig);
				if (!config || !config.syntax)
					throw new Error(`Pattern ${name} needs a syntax configuration`);

				const pattern = ASTERLang.expr(config.syntax);

				if (pattern.matches([], new Map(), []) !== -1)
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
			//console.log(tokens)
			const [SOF, t, EOF] = tokens;
			// TODO: validation and stuff
			return (t).reduce(initialState)
		}
	}
}