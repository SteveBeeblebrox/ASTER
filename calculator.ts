///#pragma once
///#include "src/asterutils.ts"

const { syntax, tag, tags, recursive, Parser } = ASTERUtils;

import { createInterface } from "node:readline"

class CalculatorGrammar {
	@syntax `/[a-z_]+/i`
	@tag `expr`
	@tag `negatable`
	variable(token: ASTER.Token, state: Map<string, number>) {
		return state.get(token.getRawValue().toLowerCase()) ?? 0;
	}

	@syntax `$..\.$..`
	@tag `expr`
	@tag `negatable`
	decimal(token: ASTER.Token, state: Map<string, number>) {
		return +token.getRawValue()
	}

	@syntax `$..`
	@tag `expr`
	@tag `negatable`
	int(token: ASTER.Token, state: Map<string, number>) {
		return +token.getRawValue()
	}

	@syntax `<<(\* || \/ || \+ || \- || \^) ~+ \- ~+ value: #negatable`
	@tag `expr`
	negative(token: ASTER.Token, state: Map<string, number>) {
		return -token.getProp('value')[0].reduce(state)
	}

	@syntax `\( (value: #expr) \)`
	@tag `expr`
	@tag `negatable`
	@recursive
	group(token: ASTER.Token, state: Map<string, number>) {
		return token.getProp('value')[0].reduce(state);
	}

	@syntax `\| (value: #expr) \|`
	@tag `expr`
	@tag `negatable`
	@recursive
	abs(token: ASTER.Token, state: Map<string, number>) {
		return Math.abs(token.getProp('value')[0].reduce(state));
	}

	@syntax `(lhs: #expr) ~+ \^ ~+ (rhs: #expr)`
	@tag `expr`
	@recursive
	pow(token: ASTER.Token, state: Map<string, number>) {
		return token.getProp('lhs')[0].reduce() ** token.getProp('rhs')[0].reduce(state);
	}

	@syntax `(lhs: #expr) ~+ (op: \* || \/) ~+ (rhs: #expr)`
	@tag `expr`
	@recursive
	multdiv(token: ASTER.Token, state: Map<string, number>) {
		if (token.getProp('op')[0].getRawValue() === '/')
			return token.getProp('lhs')[0].reduce(state) / token.getProp('rhs')[0].reduce(state);
		else
			return token.getProp('lhs')[0].reduce(state) * token.getProp('rhs')[0].reduce(state);
	}

	@syntax `(lhs: #expr) ~+ (op: \+ || \-) ~+ (rhs: #expr)`
	@tag `expr`
	@recursive
	addsub(token: ASTER.Token, state: Map<string, number>): number {
		if (token.getProp('op')[0].getRawValue() === '-')
			return token.getProp('lhs')[0].reduce(state) - token.getProp('rhs')[0].reduce(state);
		else
			return token.getProp('lhs')[0].reduce(state) + token.getProp('rhs')[0].reduce(state);
	}
}

namespace Calculator {
	const parser = new Parser<CalculatorGrammar, number, Map<string, number>>(new CalculatorGrammar());
	export function evaluate(text: string, variables: { [key: string]: number }): number {
		return parser.parse(text, new Map(Object.entries(Object.assign(variables, { pi: Math.PI, e: Math.E }))));
	}
}

console.log('ASTER Calculator Demo');

(async function() {
	process.stdout.write('> ');
	for await (const line of createInterface({ input: process.stdin })) {
		if(line === 'q') {
			return;
		} else if(line.trim()) {
			try {
				console.log(Calculator.evaluate(line, { foobar: 117 }));
			} catch(e) {
				console.error(e);
			}
		}
		process.stdout.write('> ');
	}
})();