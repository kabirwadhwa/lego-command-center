import { redirect } from "next/navigation";
import { getCurrentUser, getAppMode } from "@/lib/auth";
import { cookies } from "next/headers";
import { authenticateDemoAccessAction } from "@/app/actions/authActions";

export default async function LoginPage() {
  const user = await getCurrentUser();

  // If already logged in, redirect to dashboard
  if (user) {
    redirect("/");
  }

  const appMode = getAppMode();

  const cookieStore = await cookies();
  const hasDemoAccess = cookieStore.get("demo_access_token")?.value === "true";

  // Action for logging in using simulated demo profiles
  const handleDemoLogin = async (formData: FormData) => {
    "use server";
    const userId = formData.get("userId") as string;
    if (userId) {
      const cookieStore = await cookies();
      cookieStore.set("lego_demo_user_id", userId, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
      });
      redirect("/");
    }
  };

  // Action to verify demo password
  const handleDemoPasswordSubmit = async (formData: FormData) => {
    "use server";
    const password = formData.get("password") as string;
    if (password) {
      const res = await authenticateDemoAccessAction(password);
      if (res.success) {
        redirect("/login"); // Reload to show the choose profile switcher
      } else {
        redirect("/login?error=incorrect_password");
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center font-sans p-6">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700/60 rounded-2xl shadow-xl p-8 flex flex-col">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center font-black text-xl text-white shadow-lg shadow-blue-500/25 mb-4">
            LC
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            LEGO Command Center
          </h2>
          <p className="text-slate-400 text-xs mt-1.5 font-medium text-center">
            Sign in to access inventory, pricing recommendations, and marketplace syncs.
          </p>
        </div>

        {appMode === "demo" && !hasDemoAccess ? (
          /* Password input for Demo Access Gate */
          <form action={handleDemoPasswordSubmit} className="flex flex-col space-y-4">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300 font-medium leading-relaxed">
              <strong>Protected Demo Environment</strong>: Access requires the demo password.
            </div>

            <div className="flex flex-col space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Demo Password
              </label>
              <input
                type="password"
                name="password"
                required
                className="w-full text-xs font-semibold bg-slate-900 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-blue-500 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs p-3 rounded-lg shadow transition-colors duration-200 mt-2"
            >
              Verify Password & Enter Demo
            </button>
          </form>
        ) : appMode !== "production" ? (
          /* Demo Mode Switcher Card */
          <form action={handleDemoLogin} className="flex flex-col space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300 font-medium leading-relaxed">
              <strong>Demo Environment Active</strong>: Select a seed user profile to simulate authenticated session roles.
            </div>

            <div className="flex flex-col space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Choose Profile
              </label>
              <select
                name="userId"
                className="w-full text-xs font-semibold bg-slate-900 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-blue-500 transition-colors"
                defaultValue="44444444-4444-4444-4444-444444444444"
              >
                <option value="44444444-4444-4444-4444-444444444444">
                  Kristof Vervliet [ADMIN]
                </option>
                <option value="55555555-5555-5555-5555-555555555555">
                  Sabine Vervliet [FAMILY_SELLER]
                </option>
                <option value="66666666-6666-6666-6666-666666666666">
                  Family Assistant [VIEWER]
                </option>
              </select>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs p-3 rounded-lg shadow transition-colors duration-200 mt-2"
            >
              Sign In with Profile
            </button>
          </form>
        ) : (
          /* Real Production Auth Form */
          <form className="flex flex-col space-y-4">
            <div className="flex flex-col space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Email Address
              </label>
              <input
                type="email"
                required
                className="w-full text-xs font-semibold bg-slate-900 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-blue-500 transition-colors"
                placeholder="you@vervliet.be"
              />
            </div>

            <div className="flex flex-col space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Password
              </label>
              <input
                type="password"
                required
                className="w-full text-xs font-semibold bg-slate-900 border border-slate-700 text-white rounded-lg p-3 outline-none focus:border-blue-500 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs p-3 rounded-lg shadow transition-colors duration-200 mt-2"
            >
              Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
