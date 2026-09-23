import { CITIES, DIV, PM_MATERIALS, MAT } from "./corp-utils.js";

/** @param {NS} ns */
export async function main(ns) {
    const corp = ns.corporation;
    const buyAmount = ns.args[0] || 100; // Units per purchase
    
    for (const city of CITIES) {
        // Buy production multiplier materials
        for (const pm of PM_MATERIALS) {
            const current = corp.getMaterial(DIV.AGRICULTURE, city, pm.name);
            
            // Buy in chunks to avoid overspending
            const toBuy = Math.min(buyAmount, 10000); // Cap at 10k per call
            if (toBuy > 0) {
                corp.buyMaterial(DIV.AGRICULTURE, city, pm.name, toBuy);
            }
        }
        
        // Also buy Water and Chemicals for production (Smart Supply handles some, but we want stock)
        // Water: 0.5 per Plant, Chemicals: 0.2 per Plant [citation:1]
        // Buying extra ensures production doesn't stall
        corp.buyMaterial(DIV.AGRICULTURE, city, MAT.WATER, 50);
        corp.buyMaterial(DIV.AGRICULTURE, city, MAT.CHEMICALS, 20);
    }
    
    ns.tprint("Material purchasing set.");
}