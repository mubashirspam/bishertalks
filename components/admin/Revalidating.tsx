"use client";

import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

/**
 * Stale-while-revalidate for admin screens.
 *
 * Changing a filter is a server navigation, and React transitions already keep
 * the previous screen on display while the new one is fetched — which is the
 * behaviour we want: never blank out data you already have. What was missing
 * was any sign that something is happening, so the app looked frozen rather
 * than busy.
 *
 * This shares one transition's pending state between the controls that trigger
 * navigation and the content being replaced, so the table can dim and show a
 * progress bar while the fresh rows are on their way.
 */
interface NavigationState {
  pending: boolean;
  navigate: (url: string) => void;
}

const Ctx = createContext<NavigationState>({
  pending: false,
  navigate: () => {},
});

export function NavigationPending({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const navigate = useCallback(
    (url: string) => startTransition(() => router.push(url)),
    [router]
  );

  return <Ctx.Provider value={{ pending, navigate }}>{children}</Ctx.Provider>;
}

export function useNavigation(): NavigationState {
  return useContext(Ctx);
}

/**
 * Wraps content that gets replaced by a filter change.
 *
 * While the new data is loading the old data stays exactly where it was, dimmed
 * and non-interactive, with a progress bar on top. Clicks are blocked because
 * the rows on screen are about to be replaced — acting on a row that's already
 * stale is how someone marks the wrong order shipped.
 */
export function StaleWhileRevalidating({ children }: { children: ReactNode }) {
  const { pending } = useNavigation();

  return (
    <div className="relative">
      {pending && (
        <div className="absolute -top-1 left-0 right-0 h-0.5 overflow-hidden rounded-full z-10">
          <div className="h-full w-1/3 bg-primary-500 animate-[revalidate_1.1s_ease-in-out_infinite]" />
        </div>
      )}
      <div
        className={
          pending
            ? "opacity-45 pointer-events-none transition-opacity duration-150"
            : "transition-opacity duration-150"
        }
      >
        {children}
      </div>
    </div>
  );
}
