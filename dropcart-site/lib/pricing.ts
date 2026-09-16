export const LOAD_PRICES_CENTS={small:1499,medium:1999,large:2799} as const;
export const STAIRS_FEE_CENTS=500;
export type GroceryLoad=keyof typeof LOAD_PRICES_CENTS;
export function getUnloadPrice(load:GroceryLoad,stairs:boolean){return LOAD_PRICES_CENTS[load]+(stairs?STAIRS_FEE_CENTS:0)}
export function formatPrice(cents:number){return `$${(cents/100).toFixed(2)}`}
