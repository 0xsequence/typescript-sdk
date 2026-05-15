import {WalletClient, type OidcProviderName} from "../src/clients/walletClient";
import {OMSClient, type OMSClientSessionLoginType, type OMSClientSessionState} from "../src/index";
import {defineOmsEnvironment, type OmsEnvironment} from "../src/omsEnvironment";
import {googleOidcProvider} from "../src/oidc";

const environment = defineOmsEnvironment({
    walletApiUrl: "https://wallet.example",
    indexerUrlTemplate: "https://indexer.example/{value}",
    auth: {
        oidcProviders: {
            google: googleOidcProvider(),
        },
    },
});

type ProviderName = OidcProviderName<typeof environment>;

const configuredProvider: ProviderName = "google";
void configuredProvider;

// @ts-expect-error github is not configured in this static environment.
const unknownProvider: ProviderName = "github";
void unknownProvider;

if (false) {
    const wallet = undefined as unknown as WalletClient<typeof environment>;
    void wallet.startOidcRedirectAuth({
        provider: "google",
        redirectUri: "https://app.example/auth/callback",
    });

    void wallet.startOidcRedirectAuth({
        // @ts-expect-error github is not configured in this static environment.
        provider: "github",
        redirectUri: "https://app.example/auth/callback",
    });

    void (async () => {
        const manualAuth = await wallet.completeEmailAuth({code: "123456", autoActivate: false});
        void manualAuth.wallets;
        // @ts-expect-error manual auth does not activate a wallet.
        void manualAuth.walletAddress;

        const activatedAuth = await wallet.completeEmailAuth({code: "123456"});
        void activatedAuth.walletAddress;
        void activatedAuth.wallets;
    });
}

const defaultClient = new OMSClient({projectAccessKey: "project-key"});
const session: OMSClientSessionState = defaultClient.wallet.session;
const loginType: OMSClientSessionLoginType | undefined = defaultClient.wallet.session.loginType;
void session;
void loginType;
void defaultClient.wallet.startOidcRedirectAuth({
    provider: "google",
    redirectUri: "https://app.example/auth/callback",
});
void defaultClient.wallet.startOidcRedirectAuth({
    // @ts-expect-error github is not configured on the default environment.
    provider: "github",
    redirectUri: "https://app.example/auth/callback",
});

const customEnvironmentWithoutProviders = defineOmsEnvironment({
    walletApiUrl: "https://wallet.example",
    indexerUrlTemplate: "https://indexer.example/{value}",
});
const customClient = new OMSClient({
    projectAccessKey: "project-key",
    environment: customEnvironmentWithoutProviders,
});
let broadlyTypedClient: OMSClient;
broadlyTypedClient = customClient;
void broadlyTypedClient;
void customClient.wallet.startOidcRedirectAuth({
    // @ts-expect-error string provider names are not available without configured providers.
    provider: "google",
    redirectUri: "https://app.example/auth/callback",
});

function createClient(params: {
    projectAccessKey: string;
    environment?: OmsEnvironment;
}) {
    return new OMSClient(params);
}

void createClient({projectAccessKey: "project-key"});
void createClient({
    projectAccessKey: "project-key",
    environment: customEnvironmentWithoutProviders,
});
