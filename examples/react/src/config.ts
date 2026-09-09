export const DEMO_ENVIRONMENTS = [
  {
    id: 'production',
    label: 'Production sandbox',
    publishableKey: 'pk_sdbx_01kqfw9zaykks_01kwetq606fv699qb9bhfmb45s'
  },
  {
    id: 'development',
    label: 'Development sandbox',
    publishableKey: 'pk_dev_sdbx_01kqa06hyyetj_01kv5zt5s3eke9038q8y67jdvj'
  },
  {
    id: 'staging',
    label: 'Staging sandbox',
    publishableKey: 'pk_stg_sdbx_01kqab7as5htf_01kxgdcajtfcgv9e6f56xm3rc2'
  }
] as const;

export type DemoEnvironmentId = (typeof DEMO_ENVIRONMENTS)[number]['id'];

const DEMO_ENVIRONMENT_STORAGE_KEY = 'oms-react-example-environment';
const DEFAULT_DEMO_ENVIRONMENT_ID: DemoEnvironmentId = 'development';

export const SELECTED_DEMO_ENVIRONMENT =
  DEMO_ENVIRONMENTS.find((environment) => environment.id === storedDemoEnvironmentId()) ??
  DEMO_ENVIRONMENTS.find((environment) => environment.id === DEFAULT_DEMO_ENVIRONMENT_ID)!;

export const PUBLISHABLE_KEY = SELECTED_DEMO_ENVIRONMENT.publishableKey;

export function selectDemoEnvironment(id: DemoEnvironmentId): void {
  globalThis.localStorage.setItem(DEMO_ENVIRONMENT_STORAGE_KEY, id);
}

function storedDemoEnvironmentId(): string | null {
  return globalThis.localStorage.getItem(DEMO_ENVIRONMENT_STORAGE_KEY);
}
