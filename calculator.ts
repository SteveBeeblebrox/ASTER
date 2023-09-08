///#pragma once
///#include "src/asterutils.ts"

const { syntax, tag, tags, recursive, Parser } = ASTERUtils;

import { createInterface } from "node:readline"

type State = {
	variables: Map<string, number>;
	functions: Map<string,(arg: number)=>number>;
}

class CalculatorGrammar {
	@syntax `/[a-z_]+/i`
	@tag `expr`
	@tag `negatable`
	variable(token: ASTER.Token, state: State) {
		const name = token.getRawValue().toLowerCase();
		const value = state.variables.get(name);
		if(value == null) {
			throw new Error(`Variable '${name}' does not exist!`);
		}
		return value;
	}

	@syntax `$..\.$..`
	@tag `expr`
	@tag `negatable`
	decimal(token: ASTER.Token, state: State) {
		return +token.getRawValue()
	}

	@syntax `$..`
	@tag `expr`
	@tag `negatable`
	int(token: ASTER.Token, state: State) {
		return +token.getRawValue()
	}

	@syntax `<<(\* || \/ || \+ || \- || \^ || @SOF || \= || \( || \|) ~+ \- ~+ value: #negatable`
	@tag `expr`
	negative(token: ASTER.Token, state: State) {
		return -token.getProp('value')[0].reduce(state)
	}

	@syntax `\( (value: #expr) \)`
	@tag `expr`
	@tag `negatable`
	@recursive
	group(token: ASTER.Token, state: State) {
		return token.getProp('value')[0].reduce(state);
	}

	@syntax `(name: @variable) (arg: @group)`
	@tag `expr`
	@tag `negatable`
	@recursive
	func(token: ASTER.Token, state: State) {
		const name = token.getProp('name')[0].getRawValue().toLowerCase();
		const f = state.functions.get(name);
		if(f == null) {
			throw new Error(`Function '${name}' does not exist!`);
		}
		return f(token.getProp('arg')[0].reduce(state));
	}

	@syntax `\| (value: #expr) \|`
	@tag `expr`
	@tag `negatable`
	@recursive
	abs(token: ASTER.Token, state: State) {
		return Math.abs(token.getProp('value')[0].reduce(state));
	}

	@syntax `(lhs: #expr) ~+ \^ ~+ (rhs: #expr)`
	@tag `expr`
	@recursive
	pow(token: ASTER.Token, state: State) {
		return token.getProp('lhs')[0].reduce(state) ** token.getProp('rhs')[0].reduce(state);
	}

	@syntax `(lhs: #expr) ~+ (op: \* || \/) ~+ (rhs: #expr)`
	@tag `expr`
	@recursive
	multdiv(token: ASTER.Token, state: State) {
		if (token.getProp('op')[0].getRawValue() === '/')
			return token.getProp('lhs')[0].reduce(state) / token.getProp('rhs')[0].reduce(state);
		else
			return token.getProp('lhs')[0].reduce(state) * token.getProp('rhs')[0].reduce(state);
	}

	@syntax `(lhs: #expr) ~+ (op: \+ || \-) ~+ (rhs: #expr)`
	@tag `expr`
	@recursive
	addsub(token: ASTER.Token, state: State): number {
		if (token.getProp('op')[0].getRawValue() === '-')
			return token.getProp('lhs')[0].reduce(state) - token.getProp('rhs')[0].reduce(state);
		else
			return token.getProp('lhs')[0].reduce(state) + token.getProp('rhs')[0].reduce(state);
	}

	@syntax`(name: @variable) ~+ \= ~+ (value: #expr)`
	@tag `expr`
	@recursive
	assignment(token: ASTER.Token, state: State): number {
		const name = token.getProp('name')[0].getRawValue().toLowerCase();
		state.variables.set(name, token.getProp('value')[0].reduce(state))
		return state.variables.get(name)!;
	}
}

namespace Calculator {
	const parser = new Parser<CalculatorGrammar, number, State>(new CalculatorGrammar());
	export function evaluate(text: string, vars: { [key: string]: number }): {value: number, variables: Map<string,number>} {
		const variables = new Map(Object.entries(Object.assign(vars, { pi: Math.PI, e: Math.E })));
		return {value: +parser.parse(text, {variables, functions:new Map(Object.entries({
			sin: Math.sin,
			cos: Math.cos,
			tan: Math.tan,
			sqrt: Math.sqrt,
		}))}), variables};
	}
}

console.log('ASTER Calculator Demo');

(async function() {
	let vars = new Map<string,number>();
	process.stdout.write('> ');
	for await (const line of createInterface({ input: process.stdin })) {
		if(line === 'q') {
			return;
		} else if(line.trim()) {
			try {
				const result = Calculator.evaluate(line, Object.fromEntries(vars.entries()));
				vars = result.variables;
				console.log(result.value);
			} catch(e) {
				console.error(e);
			}
		}
		process.stdout.write('> ');
	}
})();