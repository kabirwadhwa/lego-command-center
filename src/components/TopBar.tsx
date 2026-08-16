"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, Bell, ChevronDown } from "lucide-react";
import RoleSwitcher from "./RoleSwitcher";
import Link from "next/link";

interface TopBarProps {
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
  showRoleSwitcher?: boolean;
}

export default function TopBar({ currentUser, showRoleSwitcher }: TopBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quickActionOpen, setQuickActionOpen] = useState(false);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const query = (formData.get("search") as string) || "";
    if (query.trim()) {
      router.push(`/inventory?search=${encodeURIComponent(query.trim())}`);
    } else {
      router.push("/inventory");
    }
  };

  const currentSearch = searchParams.get("search") || "";

  return (
    <header className="h-16 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 fixed top-0 right-0 left-64 z-20 shadow-sm transition-colors duration-200">
      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="w-96 relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
          <Search className="w-4 h-4" />
        </div>
        <input
          type="search"
          name="search"
          key={currentSearch}
          defaultValue={currentSearch}
          placeholder="Search LEGO set, SKU, EAN or product name..."
          className="w-full text-xs font-medium bg-slate-50 hover:bg-slate-100/70 focus:bg-white dark:bg-slate-900/60 dark:hover:bg-slate-900 dark:focus:bg-slate-950 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-all duration-200"
        />
      </form>

      {/* Action Utilities & Auth Info */}
      <div className="flex items-center gap-4">
        {/* Role Switcher (Visible in Development/Demo mode) */}
        {showRoleSwitcher && (
          <RoleSwitcher currentUser={currentUser} />
        )}

        {/* Quick Action Dropdown */}
        {currentUser?.role !== "VIEWER" && (
          <div className="relative">
            <button
              onClick={() => setQuickActionOpen(!quickActionOpen)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg shadow-sm hover:shadow transition-all duration-200"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Quick Action</span>
              <ChevronDown className="w-3 h-3 ml-0.5" />
            </button>

            {quickActionOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setQuickActionOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg py-1.5 z-50 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-all">
                  <Link
                    href="/inventory?action=add-product"
                    className="block px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setQuickActionOpen(false)}
                  >
                    Add Product Catalog
                  </Link>
                  <Link
                    href="/purchases?action=receive"
                    className="block px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setQuickActionOpen(false)}
                  >
                    Receive Stock (Purchase)
                  </Link>
                  <Link
                    href="/sales?action=sell"
                    className="block px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setQuickActionOpen(false)}
                  >
                    Sell Stock (Manual Sale)
                  </Link>
                  <Link
                    href="/inventory?action=transfer"
                    className="block px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setQuickActionOpen(false)}
                  >
                    Transfer Stock (Owner Sync)
                  </Link>
                  <Link
                    href="/inventory?action=adjust"
                    className="block px-4 py-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => setQuickActionOpen(false)}
                  >
                    Adjust Stock (Counts)
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        {/* Notifications Icon Button */}
        <Link
          href="/alerts"
          className="p-2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 relative border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 rounded-lg transition-all"
        >
          <Bell className="w-4 h-4" />
          {/* Notification Badge if active alarms exist */}
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-950" />
        </Link>
      </div>
    </header>
  );
}
