import type {
  AutomaticSelection,
  ConstructorParams,
  ErrorParams,
  ManualSelection,
  PrivateErrorCode
} from './support.js';

declare const providerBrand: unique symbol;

/** Obtain values from Providers; object literals are invalid. */
export interface BrandedProvider<Provider extends 'first' | 'second' = 'first' | 'second'> {
  readonly provider: Provider;
  readonly [providerBrand]: true;
}

export declare const Providers: Readonly<{
  first: BrandedProvider<'first'>;
  second: BrandedProvider<'second'>;
}>;

export interface RunParams {
  value: string;
  walletSelection?: 'automatic' | 'manual';
}

export interface ConfiguredClient {
  run(params: ManualSelection<RunParams>): void;
}

export declare function configure(params: ConstructorParams<string>): void;

export declare const DefaultConfiguration: ConstructorParams<boolean>;

export declare const PrimaryConfiguration: ConstructorParams<string>,
  SecondaryConfiguration: ConstructorParams<number>;

export declare class PublicClient {
  private readonly hiddenState;
  constructor(params: ConstructorParams<number>);
  execute(params: AutomaticSelection<RunParams>): void;
}

export declare class PublicError extends Error {
  constructor(params: Omit<ErrorParams<PrivateErrorCode>, 'code'> & { code?: PrivateErrorCode });
}
