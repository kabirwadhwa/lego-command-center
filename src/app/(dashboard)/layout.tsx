import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import TransferModal from "@/components/TransferModal";
import AdjustModal from "@/components/AdjustModal";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve authenticated user profile
  const user = await getCurrentUser();

  // If no active session user, redirect to login page
  if (!user) {
    redirect("/login");
  }

  // Query database configuration details for quick action modals
  const variants = await prisma.productVariant.findMany({
    where: { status: "ACTIVE" },
    include: { product: true },
    orderBy: { sku: "asc" },
  });

  const accounts = await prisma.inventoryAccount.findMany({
    where: { status: "ACTIVE" },
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-200">
      {/* Sidebar Navigation */}
      <Sidebar userRole={user.role} />

      {/* Top Header Section */}
      <TopBar currentUser={user} />

      {/* Main View Area */}
      <main className="pl-64 pt-16 min-h-screen">
        <div className="p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Global Quick Action Modals */}
      <TransferModal variants={variants} accounts={accounts} />
      <AdjustModal variants={variants} accounts={accounts} />
    </div>
  );
}

