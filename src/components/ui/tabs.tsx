"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={className} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={className} {...props} />;
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={className} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={className} {...props} />;
}