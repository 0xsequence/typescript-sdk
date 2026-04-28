export interface Network {
    id: bigint
    name: string
}

export class NetworkBindings {
    private readonly byId: ReadonlyMap<bigint, string>
    private readonly byName: ReadonlyMap<string, bigint>

    constructor(networks: readonly Network[] = NetworkBindings.DEFAULT_NETWORKS) {
        this.byId = new Map(networks.map(n => [n.id, n.name]))
        this.byName = new Map(networks.map(n => [n.name.toLowerCase(), n.id]))
    }

    findChainNameById(id: bigint): string | undefined {
        return this.byId.get(id)
    }

    getChainNameById(id: bigint): string {
        return this.findChainNameById(id) ?? 'undefined'
    }

    getChainIdByName(name: string): bigint | undefined {
        return this.byName.get(name.toLowerCase())
    }

    static readonly DEFAULT_NETWORKS: readonly Network[] = [
        { id: BigInt(137),      name: 'polygon' },
        { id: BigInt(80002),    name: 'amoy' },
    ]
}
