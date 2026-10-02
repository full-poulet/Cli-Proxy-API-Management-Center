/**
 * Email masking for screenshots and screen shares.
 *
 * `tester@1password.dev` → `t•••@1•••.dev`: the first letter of the local
 * part, the first letter of the domain and the top-level label survive, which
 * is enough to tell two logins apart without showing the address.
 *
 * Pure and store-free; the "Show emails" preference lives in
 * `useQuotaViewStore` and callers pass the decision in.
 */

const MASK = '•••';

/** Local part without hyphens on purpose: file names put a provider prefix in front
 *  (`claude-service@…`), and keeping that prefix readable is what makes the rows scannable. */
const EMAIL_RE = /([A-Za-z0-9._%+]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.([A-Za-z]{2,})/g;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mask one address. Strings that are not an address come back unchanged. */
export function maskEmail(email: string): string {
  return email.replace(EMAIL_RE, (_match, local: string, domain: string, tld: string) => {
    return `${local.charAt(0)}${MASK}@${domain.charAt(0)}${MASK}.${tld}`;
  });
}

/**
 * Mask the address inside a credential's file name.
 *
 * When the credential's own email is known it is replaced verbatim, so a
 * hyphenated local part is masked as one unit. Otherwise every address-shaped
 * run in the name is masked.
 */
export function maskCredentialName(name: string, email?: string | null): string {
  const known = email?.trim();
  if (known && name.includes(known)) {
    return name.replace(new RegExp(escapeRegExp(known), 'g'), maskEmail(known));
  }
  return maskEmail(name);
}
