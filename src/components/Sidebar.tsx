"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  ShoppingCart,
  Tags,
  Globe,
  BarChart3,
  AlertTriangle,
  History,
  Settings,
  Users,
} from "lucide-react";

interface SidebarProps {
  userRole: string | undefined;
}

export default function Sidebar({ userRole }: SidebarProps) {
  const pathname = usePathname();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Inventory", href: "/inventory", icon: Package },
    { name: "Sales", href: "/sales", icon: ShoppingBag },
    { name: "Purchases", href: "/purchases", icon: ShoppingCart },
    { name: "Pricing", href: "/pricing", icon: Tags },
    { name: "Marketplaces", href: "/marketplaces", icon: Globe },
    { name: "Analytics", href: "/analytics", icon: BarChart3 },
    { name: "Alerts", href: "/alerts", icon: AlertTriangle },
    { name: "Audit Logs", href: "/audit-logs", icon: History },
  ];

  const adminNav = [
    { name: "Users", href: "/users", icon: Users },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col h-screen fixed left-0 top-0 border-r border-slate-800 z-30">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-black text-sm tracking-wider text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform duration-200 select-none">
            LC
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm leading-tight tracking-tight text-white group-hover:text-blue-400 transition-colors">
              LEGO CommandCenter
            </span>
            <span className="text-[10px] text-slate-400 leading-none mt-0.5 tracking-wider font-semibold uppercase">
              Vervliet Ent.
            </span>
          </div>
        </Link>
      </div>

      {/* Main Navigation Links */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-7">
        <div className="space-y-1">
          <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 select-none">
            Core Operations
          </span>
          <nav className="space-y-1">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Administration (Admin-only or Settings/Users) */}
        {userRole === "ADMIN" && (
          <div className="space-y-1">
            <span className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-2 select-none">
              Administration
            </span>
            <nav className="space-y-1">
              {adminNav.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                      isActive
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                    }`}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 flex items-center gap-3 select-none">
        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-300 uppercase">
          {userRole?.substring(0, 2) || "VI"}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-semibold text-slate-200 truncate">
            {userRole === "ADMIN"
              ? "Kristof Vervliet"
              : userRole === "FAMILY_SELLER"
              ? "Sabine Vervliet"
              : "Viewer Account"}
          </span>
          <span className="text-[10px] text-slate-500 font-medium capitalize mt-0.5">
            Role: {userRole?.toLowerCase().replace("_", " ")}
          </span>
        </div>
      </div>
    </aside>
  );
}
