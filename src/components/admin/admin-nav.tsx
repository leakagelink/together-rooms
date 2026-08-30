import { Link } from "@tanstack/react-router";
import { BellRing, LayoutDashboard, MonitorPlay, Users, UserCog } from "lucide-react";

const ITEMS = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/rooms", label: "Rooms", icon: MonitorPlay },
  { to: "/admin/notifications", label: "Notifications", icon: BellRing },
  { to: "/admin/roles", label: "Roles", icon: UserCog },
] as const;

/** Shared tab strip for every admin control-center screen. */
export function AdminNav() {
  return (
    <nav aria-label="Admin sections" className="mt-4 -mx-1 overflow-x-auto pb-1">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: to === "/admin" }}
              className="flex items-center gap-2 rounded-full border border-border/70 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
              activeProps={{
                className:
                  "flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary",
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
