"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REGISTRY = void 0;
exports.loadRegistryFromFile = loadRegistryFromFile;
exports.getEnabledTools = getEnabledTools;
const fs = __importStar(require("fs"));
exports.DEFAULT_REGISTRY = {
    updatedAt: new Date().toISOString(),
    tools: [
        {
            id: 'ai_db-bench-progress',
            name: 'ai_db multimodal dedup benchmark',
            projectName: 'ai_db',
            description: 'Directly reads ai_db benchmark log/process state',
            kind: 'ai_db_bench_local',
            logPath: 'D:/Project/git/ai_db/multimodal_dedup_bench_1m.log',
            enabled: true,
            timeoutMs: 3000,
            staleSecondsThreshold: 300,
            tags: ['benchmark', 'dedup', 'ai_db'],
        },
    ],
};
function loadRegistryFromFile(registryFile) {
    if (!registryFile)
        return exports.DEFAULT_REGISTRY;
    if (!fs.existsSync(registryFile))
        return exports.DEFAULT_REGISTRY;
    try {
        const raw = fs.readFileSync(registryFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.tools))
            return exports.DEFAULT_REGISTRY;
        return parsed;
    }
    catch {
        return exports.DEFAULT_REGISTRY;
    }
}
function getEnabledTools(registry) {
    return registry.tools.filter((t) => t.enabled !== false);
}
//# sourceMappingURL=registry.js.map