import {WalletClient, type OidcProviderName} from "../src/clients/walletClient";
import {defineOmsEnvironment} from "../src/omsEnvironment";
import {googleOidcProvider} from "../src/oidc";

const environment = defineOmsEnvironment({
    walletApiUrl: "https://wallet.example",
    apiRpcUrl: "https://api.example",
    indexerUrlTemplate: "https://indexer.example/{value}",
    auth: {
        oidcProviders: {
            google: googleOidcProvider({clientId: "google-client"}),
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
}
