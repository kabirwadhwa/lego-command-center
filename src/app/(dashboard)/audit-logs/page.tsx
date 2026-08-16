import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ChevronLeft, ChevronRight, History, Search } from "lucide-react";
import Link from "next/link";

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    page?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  const search = params.search || "";
  const page = parseInt(params.page || "1", 10);
  const pageSize = 15;

  // 1. Build Prisma query filters
  const whereClause: Prisma.AuditLogWhereInput = {};

  if (search) {
    whereClause.OR = [
      { actorName: { contains: search, mode: "insensitive" } },
      { action: { contains: search, mode: "insensitive" } },
      { details: { contains: search, mode: "insensitive" } },
    ];
  }

  // 2. Query total logs count for pagination
  const totalLogs = await prisma.auditLog.count({ where: whereClause });
  const totalPages = Math.ceil(totalLogs / pageSize);

  // 3. Query audit logs with pagination
  const logs = await prisma.auditLog.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const getPageLink = (pageNumber: number) => {
    const currentParams = new URLSearchParams();
    if (search) currentParams.set("search", search);
    currentParams.set("page", pageNumber.toString());
    return `/audit-logs?${currentParams.toString()}`;
  };

  const handleSearchSubmit = async (formData: FormData) => {
    "use server";
    const query = formData.get("search") as string;
    if (query?.trim()) {
      redirect(`/audit-logs?search=${encodeURIComponent(query.trim())}`);
    } else {
      redirect("/audit-logs");
    }
  };

  return (
    <div className="space-y-6 font-sans transition-colors duration-200">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Immutable System Audit Trail
        </h1>
        <p className="text-slate-500 text-xs mt-1.5 font-medium">
          Review historic operations logs, administrative intakes, inventory transfers, adjustments, and order settlement tracks.
        </p>
      </div>

      {/* Toolbar Search */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <form action={handleSearchSubmit} className="w-80 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="Search logs by action, actor, or details..."
            className="w-full text-xs font-semibold bg-white hover:bg-slate-50 focus:bg-white dark:bg-slate-900 dark:hover:bg-slate-900/80 dark:focus:bg-slate-950 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 pl-10 pr-4 py-2 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:border-blue-500 dark:focus:border-blue-500 transition-all duration-200"
          />
        </form>
      </div>

      {/* Logs Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-950 dark:text-white tracking-tight">
            Security & Operation Ledger
          </h2>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest select-none">
              <th className="py-3.5 px-6">Timestamp</th>
              <th className="py-3.5 px-4">Actor</th>
              <th className="py-3.5 px-4">Action</th>
              <th className="py-3.5 px-6">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-350">
            {logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-slate-400 font-semibold select-none">
                  No system audit records found.
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                  <td className="py-4 px-6 text-slate-450 dark:text-slate-500 font-medium whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap">
                    <span className="font-bold text-slate-900 dark:text-white block">
                      {log.actorName}
                    </span>
                    <span className="text-[9px] text-slate-400 font-medium tracking-wide uppercase mt-0.5 block">
                      Type: {log.actorType}
                    </span>
                  </td>
                  <td className="py-4 px-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-750 dark:bg-slate-800 dark:text-slate-300">
                      {log.action}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
                    {log.details || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span className="select-none">
              Showing Page {page} of {totalPages} ({totalLogs} logs total)
            </span>
            <div className="flex gap-2">
              <Link
                href={page > 1 ? getPageLink(page - 1) : "#"}
                className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors ${
                  page > 1
                    ? "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    : "opacity-45 cursor-not-allowed"
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
              </Link>
              <Link
                href={page < totalPages ? getPageLink(page + 1) : "#"}
                className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors ${
                  page < totalPages
                    ? "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    : "opacity-45 cursor-not-allowed"
                }`}
              >
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
