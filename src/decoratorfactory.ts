//#pragma once

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