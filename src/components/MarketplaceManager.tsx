"use client";

import { useState } from "react";
import Link from "next/link";
import { MarketplaceType } from "@prisma/client";
import { saveMarketplaceConfigAction, disconnectMarketplaceAction, testMarketplaceConnectionAction } from "@/app/actions/marketplaceActions";

interface MarketplaceConfig {
  id: MarketplaceType;
  name: string;
  status: string;
  mode: string;
  credentialsJson: string | null;
  lastSyncedAt: Date | null;
}

interface MarketplaceManagerProps {
  initialMarketplaces: MarketplaceConfig[];
}

export default function MarketplaceManager({ initialMarketplaces }: MarketplaceManagerProps) {
  const [marketplaces, setMarketplaces] = useState<MarketplaceConfig[]>(initialMarketplaces);
  const [editingId, setEditingId] = useState<MarketplaceType | null>(null);
  
  // Forms state
  const [mode, setMode] = useState<"REAL" | "DEMO">("DEMO");
  const [shopifyFields, setShopifyFields] = useState({ shopName: "", accessToken: "", webhookSecret: "" });
  const [bolFields, setBolFields] = useState({ clientId: "", clientSecret: "" });
  
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const startEditing = (m: MarketplaceConfig) => {
    setEditingId(m.id);
    setMode(m.mode as "REAL" | "DEMO");
    setTestResult(null);
    setActionError(null);

    // Populate credentials
    if (m.credentialsJson) {
      try {
        const creds = JSON.parse(m.credentialsJson);
        if (m.id === MarketplaceType.SHOPIFY) {
          setShopifyFields({
            shopName: creds.shopName || "",
            accessToken: creds.accessToken || "",
            webhookSecret: creds.webhookSecret || "",
          });
        } else if (m.id === MarketplaceType.BOL) {
          setBolFields({
            clientId: creds.clientId || "",
            clientSecret: creds.clientSecret || "",
          });
        }
      } catch {
        // Fallback clear
      }
    } else {
      setShopifyFields({ shopName: "", accessToken: "", webhookSecret: "" });
      setBolFields({ clientId: "", clientSecret: "" });
    }
  };

  const getCredentials = (id: MarketplaceType) => {
    if (id === MarketplaceType.SHOPIFY) return shopifyFields;
    if (id === MarketplaceType.BOL) return bolFields;
    return {};
  };

  const handleTest = async (id: MarketplaceType) => {
    setTesting(true);
    setTestResult(null);
    const creds = getCredentials(id);
    
    try {
      const res = await testMarketplaceConnectionAction(id, mode, creds);
      setTestResult(res);
    } catch {
      setTestResult({ success: false, error: "Testing connection failed." });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (id: MarketplaceType) => {
    setSaving(true);
    setActionError(null);
    const creds = getCredentials(id);

    try {
      const res = await saveMarketplaceConfigAction(id, mode, creds);
      if (res.success) {
        // Update local state
        setMarketplaces(prev => prev.map(m => {
          if (m.id === id) {
            return {
              ...m,
              status: "CONNECTED",
              mode,
              credentialsJson: JSON.stringify(creds)
            };
          }
          return m;
        }));
        setEditingId(null);
      } else {
        setActionError(res.error || "Failed to save configuration.");
      }
    } catch {
      setActionError("Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (id: MarketplaceType) => {
    if (!confirm(`Are you sure you want to disconnect ${id}?`)) return;
    setSaving(true);
    setActionError(null);

    try {
      const res = await disconnectMarketplaceAction(id);
      if (res.success) {
        setMarketplaces(prev => prev.map(m => {
          if (m.id === id) {
            return {
              ...m,
              status: "DISCONNECTED",
              mode: "DEMO",
              credentialsJson: null
            };
          }
          return m;
        }));
        setEditingId(null);
      } else {
        setActionError(res.error || "Failed to disconnect.");
      }
    } catch {
      setActionError("Failed to disconnect.");
    } finally {
      setSaving(false);
    }
  };

  const getCapabilitiesText = (id: MarketplaceType) => {
    if (id === MarketplaceType.SHOPIFY) {
      return ["Orders (Sync/Import)", "Inventory Sync", "Real pricing lookup", "Webhooks signature validation"];
    }
    if (id === MarketplaceType.BOL) {
      return ["Orders (Sync/Import)", "Inventory Sync", "Real pricing lookup"];
    }
    return ["Auction Listings lookup", "Bid tracking", "Past sold pricing feed"];
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {marketplaces.map((m) => {
          const isEditing = editingId === m.id;
          const isConnected = m.status === "CONNECTED";
          const isReal = m.mode === "REAL";

          return (
            <div key={m.id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-lg transition-transform hover:-translate-y-0.5 duration-200">
              {/* Header */}
              <div className="px-6 py-4 border-b border-slate-700 bg-slate-900/60 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-white tracking-tight capitalize">
                    {m.id.toLowerCase()}
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-medium tracking-wider uppercase">
                    {isReal ? "Production Connection" : "Demo Simulation Mode"}
                  </p>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                  isConnected 
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25" 
                    : "bg-slate-700/50 text-slate-400 border border-slate-650"
                }`}>
                  {m.status}
                </span>
              </div>

              {/* Body */}
              <div className="p-6 flex-1 flex flex-col justify-between space-y-6">
                {!isEditing ? (
                  <>
                    <div className="space-y-4">
                      {/* Connection details */}
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="text-slate-400 block font-medium">Integration Mode</span>
                          <span className="text-white font-semibold mt-0.5 block">{m.mode}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-medium">Last Sync Run</span>
                          <span className="text-white font-semibold mt-0.5 block">
                            {m.lastSyncedAt ? new Date(m.lastSyncedAt).toLocaleString() : "Never"}
                          </span>
                        </div>
                      </div>

                      {/* Capabilities */}
                      <div>
                        <span className="text-slate-400 text-xs block font-medium mb-1.5">Supported Capabilities</span>
                        <ul className="space-y-1">
                          {getCapabilitiesText(m.id).map((cap, i) => (
                            <li key={i} className="text-slate-300 text-xs flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                              {cap}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="space-y-2">
                      {m.id === MarketplaceType.SHOPIFY && (
                        <Link
                          href="/marketplaces/shopify/import"
                          className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-md shadow-blue-500/10 text-center block"
                        >
                          Onboard & Import Catalog
                        </Link>
                      )}
                      <button
                        onClick={() => startEditing(m)}
                        className="w-full py-2 px-4 bg-slate-700 hover:bg-slate-600 active:bg-slate-650 text-white font-semibold text-xs rounded-lg transition-colors border border-slate-600"
                      >
                        Configure Settings
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    {/* Toggle Mode */}
                    <div className="space-y-1">
                      <label className="text-slate-400 text-xs font-semibold block">Integration Mode</label>
                      <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1 rounded-lg border border-slate-700">
                        <button
                          type="button"
                          onClick={() => setMode("DEMO")}
                          className={`py-1.5 text-xs font-bold rounded-md transition-all ${
                            mode === "DEMO" ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                          }`}
                        >
                          DEMO Mode
                        </button>
                        <button
                          type="button"
                          onClick={() => setMode("REAL")}
                          className={`py-1.5 text-xs font-bold rounded-md transition-all ${
                            mode === "REAL" ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                          }`}
                        >
                          REAL Mode
                        </button>
                      </div>
                    </div>

                    {/* Mode credentials form */}
                    {mode === "REAL" && (
                      <div className="space-y-3 pt-2">
                        {m.id === MarketplaceType.SHOPIFY && (
                          <>
                            <div className="space-y-1">
                              <label className="text-slate-400 text-xs font-semibold block">Shopify Store Name</label>
                              <input
                                type="text"
                                placeholder="my-store.myshopify.com"
                                value={shopifyFields.shopName}
                                onChange={e => setShopifyFields(prev => ({ ...prev, shopName: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-medium rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 text-xs font-semibold block">API Access Token</label>
                              <input
                                type="password"
                                placeholder="shpat_..."
                                value={shopifyFields.accessToken}
                                onChange={e => setShopifyFields(prev => ({ ...prev, accessToken: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-medium rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 text-xs font-semibold block">Webhook Signing Secret</label>
                              <input
                                type="password"
                                placeholder="Shopify Webhook Signature"
                                value={shopifyFields.webhookSecret}
                                onChange={e => setShopifyFields(prev => ({ ...prev, webhookSecret: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-medium rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                              />
                            </div>
                          </>
                        )}

                        {m.id === MarketplaceType.BOL && (
                          <>
                            <div className="space-y-1">
                              <label className="text-slate-400 text-xs font-semibold block">Client ID</label>
                              <input
                                type="text"
                                placeholder="Bol API Client ID"
                                value={bolFields.clientId}
                                onChange={e => setBolFields(prev => ({ ...prev, clientId: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-medium rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-slate-400 text-xs font-semibold block">Client Secret</label>
                              <input
                                type="password"
                                placeholder="Bol API Client Secret"
                                value={bolFields.clientSecret}
                                onChange={e => setBolFields(prev => ({ ...prev, clientSecret: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 text-white text-xs font-medium rounded-lg px-3 py-2 outline-none focus:border-blue-500 transition-colors"
                              />
                            </div>
                          </>
                        )}

                        {m.id === MarketplaceType.CATAWIKI && (
                          <p className="text-xs text-amber-400 font-medium">
                            Catawiki real connection settings are not available. Use DEMO mode to simulate listings.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Feedback Messages */}
                    {testResult && (
                      <div className={`p-3 rounded-lg text-xs font-semibold border ${
                        testResult.success 
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                          : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                      }`}>
                        {testResult.success ? "✓ Connection verification succeeded!" : `✗ Connection failed: ${testResult.error}`}
                      </div>
                    )}

                    {actionError && (
                      <div className="p-3 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-lg text-xs font-semibold">
                        {actionError}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="space-y-2 pt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleTest(m.id)}
                          disabled={testing || saving}
                          className="py-2 px-3 bg-slate-700 hover:bg-slate-600 active:bg-slate-650 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors border border-slate-600"
                        >
                          {testing ? "Testing..." : "Test Connection"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSave(m.id)}
                          disabled={testing || saving}
                          className="py-2 px-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors shadow-md shadow-blue-500/10"
                        >
                          {saving ? "Saving..." : "Save Settings"}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleDisconnect(m.id)}
                          disabled={testing || saving || m.status === "DISCONNECTED"}
                          className="py-2 px-3 bg-rose-600/10 hover:bg-rose-600/20 active:bg-rose-600/35 disabled:opacity-50 text-rose-400 font-semibold text-xs rounded-lg transition-colors border border-rose-500/25"
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          disabled={testing || saving}
                          className="py-2 px-3 bg-slate-900 hover:bg-slate-850 active:bg-slate-800 text-slate-400 font-semibold text-xs rounded-lg transition-colors border border-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
