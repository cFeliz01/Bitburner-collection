import { CITIES, DIV, MAT, EXPORT_FORMULA } from "./corp-utils.js";

/** @param {NS} ns */
export async function main(ns) {
    const corp = ns.corporation;
    
    for (const city of CITIES) {
        // Cancel any existing exports first to avoid errors
        try {
            corp.cancelExportMaterial(
                DIV.AGRICULTURE, city,
                DIV.CHEMICAL, city,
                MAT.PLANTS
            );
        } catch (e) { /* No existing export */ }
        
        try {
            corp.cancelExportMaterial(
                DIV.CHEMICAL, city,
                DIV.AGRICULTURE, city,
                MAT.CHEMICALS
            );
        } catch (e) { /* No existing export */ }
        
        // Set up new exports with dynamic formula
        // Agriculture → Chemical: Plants
        corp.exportMaterial(
            DIV.AGRICULTURE, city,
            DIV.CHEMICAL, city,
            MAT.PLANTS,
            EXPORT_FORMULA
        );
        
        // Chemical → Agriculture: Chemicals
        corp.exportMaterial(
            DIV.CHEMICAL, city,
            DIV.AGRICULTURE, city,
            MAT.CHEMICALS,
            EXPORT_FORMULA
        );
    }
    
    ns.tprint("Export relationships established between Agriculture and Chemical.");
}