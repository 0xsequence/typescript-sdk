import {WalletClient, type OidcProviderName} from "../src/clients/walletClient";
import {
    Networks,
    OMSClient,
    findNetworkById,
    findNetworkByName,
    supportedNetworks,
    type Network,
    type OMSClientSessionLoginType,
    type OMSClientSessionState,
} from "../src/index";
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

const defaultClient = new OMSClient({
    publicApiKey: "public-api-key",
    projectId: "project-id",
});
// @ts-expect-error publicApiKey is required.
new OMSClient({projectId: "project-id"});
// @ts-expect-error projectId is required.
new OMSClient({publicApiKey: "public-api-key"});
// @ts-expect-error old projectAccessKey initializer name is not supported.
new OMSClient({projectAccessKey: "public-api-key", projectId: "project-id"});
// @ts-expect-error old authorizationScope initializer name is not supported.
new OMSClient({publicApiKey: "public-api-key", authorizationScope: "project-id"});
const session: OMSClientSessionState = defaultClient.wallet.session;
const loginType: OMSClientSessionLoginType | undefined = defaultClient.wallet.session.loginType;
const polygonNetwork: Network = Networks.polygon;
const amoyNetwork: Network | undefined = findNetworkById(80002);
const baseNetwork: Network | undefined = findNetworkByName("base");
const allNetworks: readonly Network[] = supportedNetworks;
void session;
void loginType;
void polygonNetwork;
void amoyNetwork;
void baseNetwork;
void allNetworks;
void defaultClient.supportedNetworks;
// @ts-expect-error findNetworkById accepts numeric chain IDs only.
findNetworkById("80002");
void defaultClient.indexer.getTokenBalances({
    network: Networks.polygon,
    contractAddress: "0x2222222222222222222222222222222222222222",
    walletAddress: "0x9999999999999999999999999999999999999999",
    includeMetadata: false,
});
void defaultClient.indexer.getTokenBalances({
    // @ts-expect-error Indexer public methods accept Network objects, not numeric chain IDs.
    network: 137,
    contractAddress: "0x2222222222222222222222222222222222222222",
    walletAddress: "0x9999999999999999999999999999999999999999",
    includeMetadata: false,
});
void defaultClient.indexer.getTokenBalances({
    // @ts-expect-error chainId is not a public indexer parameter.
    chainId: 137,
    contractAddress: "0x2222222222222222222222222222222222222222",
    walletAddress: "0x9999999999999999999999999999999999999999",
    includeMetadata: false,
});
void defaultClient.indexer.getNativeTokenBalance({
    network: Networks.polygon,
    walletAddress: "0x9999999999999999999999999999999999999999",
});
void defaultClient.indexer.getNativeTokenBalance({
    // @ts-expect-error Indexer public methods accept Network objects, not numeric chain IDs.
    network: 137,
    walletAddress: "0x9999999999999999999999999999999999999999",
});
void defaultClient.indexer.getNativeTokenBalance({
    // @ts-expect-error chainId is not a public indexer parameter.
    chainId: 137,
    walletAddress: "0x9999999999999999999999999999999999999999",
});
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
    publicApiKey: "public-api-key",
    projectId: "project-id",
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
    publicApiKey: string;
    projectId: string;
    environment?: OmsEnvironment;
}) {
    return new OMSClient(params);
}

void createClient({
    publicApiKey: "public-api-key",
    projectId: "project-id",
});
void createClient({
    publicApiKey: "public-api-key",
    projectId: "project-id",
    environment: customEnvironmentWithoutProviders,
});
