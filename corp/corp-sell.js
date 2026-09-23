import { CITIES, DIV, MAT } from "./corp-utils.js";

/** @param {NS} ns */
export async function main(ns) {
    const corp = ns.corporation;
    
    for (const city of CITIES) {
        // Sell Plants and Food at MAX price to start
        // Once Market-TA II is researched, switch to that
        const hasTA2 = corp.hasResearched(DIV.AGRICULTURE, "Market-TA.II");
        
        const priceMode = hasTA2 ? "MP" : "MP"; // TA.II auto-prices when enabled
        
        if (hasTA2) {
            // Enable TA.II for auto-pricing
            try {
                corp.setMaterialMarketTa2(DIV.AGRICULTURE, city, MAT.PLANTS, true);
                corp.setMaterialMarketTa2(DIV.AGRICULTURE, city, MAT.FOOD, true);
            } catch (e) { /* Research not ready */ }
        }
        
        // Set sell amounts to MAX
        corp.sellMaterial(DIV.AGRICULTURE, city, MAT.PLANTS, "MAX", priceMode);
        corp.sellMaterial(DIV.AGRICULTURE, city, MAT.FOOD, "MAX", priceMode);
    }
    
    ns.tprint("Selling configured for Agriculture materials.");
}