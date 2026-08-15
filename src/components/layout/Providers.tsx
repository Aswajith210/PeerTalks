"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/Toast";
import { KeyboardShortcuts } from "@/components/ui/KeyboardShortcuts";
import { TokensProvider } from "@/hooks/useTokens";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TokensProvider>
        <MotionConfig reducedMotion="user">
          {children}
          <Toaster />
          <KeyboardShortcuts />
        </MotionConfig>
      </TokensProvider>
    </QueryClientProvider>
  );
}
