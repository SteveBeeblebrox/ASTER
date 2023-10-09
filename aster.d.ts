declare namespace ASTER {
    type TokenMatcherCaptures = Map<string, Token[] | null>;
    type TokenPosition = {
        start: number;
        length: number;
    };
    type TokenPattern = {
        matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): number;
    };
    type SingleTokenPattern = TokenPattern & {
        matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1 | 0 | 1;
    };
    type NonConsumingTokenPattern = TokenPattern & {
        matches(tokens: Token[], captures: TokenMatcherCaptures, previosTokens: Token[]): -1 | 0;
    };
    type TokenArgs = {
        tags?: string | string[];
        props?: object | Map<string, any>;
        children?: Token[];
    };
    type Tokenizer = {
        pattern: TokenPattern;
        recursive?: boolean;
        result: string | ((matches: Token[], position: TokenPosition, captures: TokenMatcherCaptures) => Token | Token[]);
    };
    class Token {
        private readonly name;
        private readonly position;
        private readonly tags;
        private readonly properties;
        private readonly children?;
        constructor(name: string, position: TokenPosition, { tags, props, children }?: TokenArgs);
        getName(): string;
        hasTag(tag: string): boolean;
        hasProp(prop: string): boolean;
        getProp(prop: string): any;
        hasChildren(): boolean;
        getChildren(): Token[];
        getStart(): number;
        getLength(): number;
        getRawValue(): string;
    }
    class CharToken extends Token {
        private readonly value;
        constructor(value: string, position: TokenPosition, { tags, props }?: Omit<TokenArgs, 'children'>);
        getValue(): string;
        getRawValue(): string;
    }
    function tokenize(text: string, tokenizers: Tokenizer[]): Token[];
    namespace PatternBuilders {
        function tk(value: string): SingleTokenPattern;
        function char(value: string): SingleTokenPattern;
        function str(value: string): TokenPattern;
        function capture(name: string, matcher: TokenPattern): TokenPattern;
        function wildchar(pattern?: '*' | '~' | '$'): SingleTokenPattern;
        function seq(...matchers: TokenPattern[]): TokenPattern;
        function count(matcher: TokenPattern, { min, max }?: {
            min?: number | undefined;
            max?: number | undefined;
        }): TokenPattern;
        function any(matcher: TokenPattern): TokenPattern;
        function optional(matcher: TokenPattern): TokenPattern;
        function or(...matchers: TokenPattern[]): TokenPattern;
        function or(...matchers: SingleTokenPattern[]): SingleTokenPattern;
        function not(matcher: SingleTokenPattern): SingleTokenPattern;
        function hasprop(name: string): SingleTokenPattern;
        function propeq(name: string, value: any): SingleTokenPattern;
        function is(tag: string): SingleTokenPattern;
        function and(...matchers: TokenPattern[]): TokenPattern;
        function and(...matchers: SingleTokenPattern[]): SingleTokenPattern;
        function re(pattern: string, { ignoreCase }?: {
            ignoreCase?: boolean | undefined;
        }): TokenPattern;
        function lambda(f: (token: Token) => boolean): SingleTokenPattern;
        function next(matcher: TokenPattern): NonConsumingTokenPattern;
        function prev(matcher: TokenPattern): NonConsumingTokenPattern;
    }
}
declare namespace ASTERLang {
    function expr(text: string): ASTER.TokenPattern;
}
declare namespace DecoratorFactory {
    function invokeDefault(value: Class | Function, context: DecoratorContext, ...args: unknown[]): any;
    function decorator<Context extends DecoratorContext, Args extends Array<unknown>, Value, Return extends Function | void>(f: (value: Value, context: Context, ...args: Partial<Args>) => Return): {
        (...args: Partial<Args>): (value: Value, context: Context) => Return;
        (value: Value, context: Context): Return;
    };
    type Class<A extends Array<unknown> = any[], R = any> = new (...args: A) => R;
    type Function<A extends Array<unknown> = any[], R = any> = (...args: A) => R;
}
declare namespace ASTERUtils {
    const tags: {
        (tags?: string[] | undefined): (value: object, context: DecoratorContext) => void;
        (value: object, context: DecoratorContext): void;
    };
    const tag: {
        (tag?: string | TemplateStringsArray | undefined, values?: any[] | undefined): (value: object, context: DecoratorContext) => void;
        (value: object, context: DecoratorContext): void;
    };
    const syntax: {
        (syntax?: string | TemplateStringsArray | undefined, values?: any[] | undefined): (value: object, context: DecoratorContext) => void;
        (value: object, context: DecoratorContext): void;
    };
    const recursive: {
        (recursive?: boolean | undefined): (value: object, context: DecoratorContext) => void;
        (value: object, context: DecoratorContext): void;
    };
    interface Reducable<State, Target> {
        reduce(state: State): Target;
    }
    class Parser<GrammarType, Target, State> {
        private readonly DynamicToken;
        private readonly tokenizers;
        constructor(grammar: GrammarType & {
            [k in Exclude<keyof GrammarType, `_${string}`>]: (token: ASTER.Token, state: State) => Target;
        });
        parse(text: string, initialState: State): Target;
    }
}
