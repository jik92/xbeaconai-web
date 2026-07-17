import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { router } from "./router";

const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:5_000,retry:1}}});
export function AppProviders() { return <QueryClientProvider client={queryClient}><RouterProvider router={router}/><Toaster richColors position="top-center"/></QueryClientProvider>; }
