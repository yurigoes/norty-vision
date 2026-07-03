import { getPublicSettings } from "../lib/platform";

interface BrandLogoProps {
  /** Tamanho h-X do Tailwind. Default: h-7 (28px). */
  size?: "sm" | "md" | "lg" | "xl";
  /** Se true, sempre mostra o nome ao lado da logo. */
  showName?: boolean;
  /** Se true, mesmo tendo logo cai pro texto (uso em footer/cabeçalho minimal). */
  textOnly?: boolean;
  /** Classes adicionais no wrapper. */
  className?: string;
}

const SIZE_MAP: Record<NonNullable<BrandLogoProps["size"]>, string> = {
  sm: "h-5",
  md: "h-7",
  lg: "h-10",
  xl: "h-14",
};

/**
 * Renderiza a marca da plataforma:
 *  - Tem logoUrl configurado? mostra <img>
 *  - Senão: mostra o productName em texto
 *  - showName=true: mostra logo + nome
 *
 * Server component — busca platform_settings via lib cacheada.
 */
export async function BrandLogo({
  size = "md",
  showName = false,
  textOnly = false,
  className = "",
}: BrandLogoProps) {
  const s = await getPublicSettings();
  const hClass = SIZE_MAP[size];

  if (textOnly || !s.logoUrl) {
    return (
      <span className={`font-semibold tracking-tight ${className}`}>
        {s.productName}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img
        src={s.logoUrl}
        alt={s.productName}
        className={`${hClass} w-auto object-contain dark:hidden`}
      />
      {s.logoDarkUrl ? (
        <img
          src={s.logoDarkUrl}
          alt={s.productName}
          className={`${hClass} hidden w-auto object-contain dark:block`}
        />
      ) : (
        <img
          src={s.logoUrl}
          alt={s.productName}
          className={`${hClass} hidden w-auto object-contain dark:block`}
        />
      )}
      {showName && (
        <span className="font-semibold tracking-tight">{s.productName}</span>
      )}
    </span>
  );
}
