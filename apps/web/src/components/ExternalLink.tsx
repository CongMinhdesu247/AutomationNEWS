import type { AnchorHTMLAttributes, ReactNode } from "react";
import { safeExternalHref } from "@hub/contracts";

type ExternalLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> & {
  href: string | null | undefined;
  children: ReactNode;
};

/**
 * Renders an external <a> only when the URL has a validated http:/https: scheme
 * without embedded credentials; otherwise renders inert text to block javascript:/data: XSS.
 */
export function ExternalLink({
  href,
  children,
  className,
  ...rest
}: ExternalLinkProps) {
  const safeHref = safeExternalHref(href);
  if (!safeHref) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      {...rest}
      href={safeHref}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
