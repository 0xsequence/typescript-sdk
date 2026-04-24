export interface Network {
    id: bigint
    name: string
}

export class NetworkBindings {
    private readonly byId: ReadonlyMap<bigint, string>

    constructor(networks: readonly Network[] = NetworkBindings.DEFAULT_NETWORKS) {
        this.byId = new Map(networks.map(n => [n.id, n.name]))
    }

    getChainNameById(id: bigint): string {
        return this.byId.get(id) ?? 'undefined'
    }

    static readonly DEFAULT_NETWORKS: readonly Network[] = [
        { id: BigInt(137),      name: 'polygon' },
        { id: BigInt(80002),    name: 'amoy' },
    ]
}