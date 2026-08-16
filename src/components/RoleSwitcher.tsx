"use client";

import { useState, startTransition } from "react";
import { switchDemoUser } from "@/app/actions/authActions";
import { useRouter } from "next/navigation";

interface RoleSwitcherProps {
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: string;
  } | null;
}

export default function RoleSwitcher({ currentUser }: RoleSwitcherProps) {
  const router = useRouter();
  const [activeUser, setActiveUser] = useState(currentUser?.id || "44444444-4444-4444-4444-444444444444");
  const [loading, setLoading] = useState(false);

  const handleSwitch = async (userId: string) => {
    setLoading(true);
    setActiveUser(userId);
    try {
      const res = await switchDemoUser(userId);
      if (res.success) {
        startTransition(() => {
          router.refresh();
        });
      } else {
        alert(res.message);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to switch demo user.");
    } finally {
      setLoading(false);
    }
  };

  const users = [
    { id: "44444444-4444-4444-4444-444444444444", name: "Kristof (Admin)", role: "ADMIN" },
    { id: "55555555-5555-5555-5555-555555555555", name: "Sabine (Seller)", role: "FAMILY_SELLER" },
    { id: "66666666-6666-6666-6666-666666666666", name: "Assistant (Viewer)", role: "VIEWER" },
  ];

  return (
    <div className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 text-xs shadow-sm">
      <span className="text-slate-500 font-medium select-none">Acting as:</span>
      <select
        value={activeUser}
        disabled={loading}
        onChange={(e) => handleSwitch(e.target.value)}
        className="font-semibold text-slate-800 dark:text-slate-100 bg-transparent border-none outline-none focus:ring-0 cursor-pointer pr-4"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
            {u.name} [{u.role}]
          </option>
        ))}
      </select>
    </div>
  );
}
