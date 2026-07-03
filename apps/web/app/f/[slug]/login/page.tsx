"use client";

import { use } from "react";
import { SupplierLoginForm } from "../../SupplierLoginForm";

export default function SupplierSlugLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <SupplierLoginForm slug={slug} />;
}
