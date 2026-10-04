import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pill } from "@/components/app/pills";
import { AutonomyToggle } from "@/components/settings/autonomy-toggle";
import { AvailabilityForm, type DayWindows } from "@/components/settings/availability-form";
import { BlackoutDates, type BlackoutItem } from "@/components/settings/blackout-dates";
import { Panel, SettingsSection } from "@/components/settings/fields";
import { HostedForms, type HostedFormItem } from "@/components/settings/hosted-forms";
import { ProfileForm } from "@/components/settings/profile-form";
import { RubricForm } from "@/components/settings/rubric-form";
import { VoiceForm } from "@/components/settings/voice-form";
import { WebhookGuides } from "@/components/settings/webhook-guides";
import { WebhookTokens, type TokenItem } from "@/components/settings/webhook-tokens";
import { requireOrgContext } from "@/lib/auth/session";
import type { AvailabilityRule, Blackout, WebhookToken } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { limitsFor } from "@/lib/services/plan-limits";
import { getSettingsData } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { id: "profile", label: "Profile & time zone" },
  { id: "availability", label: "Availability" },
  { id: "rubric", label: "Rubric & offer" },
  { id: "voice", label: "Voice & signature" },
  { id: "autonomy", label: "Auto-reply" },
  { id: "forms", label: "Hosted forms" },
  { id: "webhooks", label: "Webhooks" },
] as const;

function appBaseUrl(): string {
  return publicEnv.appUrl.replace(/\/+$/, "");
}

/** Server's IANA list, plus UTC and the saved zone (ICU leaves UTC out, and may use older aliases). */
function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  set.add("UTC");
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function groupRules(rules: AvailabilityRule[]): DayWindows[] {
  const map = new Map<number, DayWindows>();
  for (const r of [...rules].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute)) {
    const day = map.get(r.weekday) ?? { weekday: r.weekday, windows: [] };
    day.windows.push({ startMinute: r.startMinute, endMinute: r.endMinute });
    map.set(r.weekday, day);
  }
  return [...map.values()];
}

/** "YYYY-MM-DD" for `now` in `timeZone`. */
function localIsoDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function blackoutItems(rows: Blackout[], today: string): BlackoutItem[] {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return rows.map((b) => ({
    id: b.id,
    date: b.date,
    label: fmt.format(new Date(`${b.date}T00:00:00Z`)),
    reason: b.reason,
    past: b.date < today,
  }));
}

function tokenItems(rows: WebhookToken[], base: string, timeZone: string): TokenItem[] {
  // Active first, newest first within each group.
  const sorted = [...rows].sort(
    (a, b) => Number(Boolean(a.revokedAt)) - Number(Boolean(b.revokedAt)) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return sorted.map((t) => ({
    id: t.id,
    label: t.sourceLabel,
    endpoint: t.revokedAt ? null : `${base}/api/leads/webhook/${t.token}`,
    masked: `${base}/api/leads/webhook/${"•".repeat(8)}${t.revokedAt ? t.token.slice(-4) : ""}`,
    createdLabel: formatDateTime(t.createdAt, timeZone),
    lastUsedLabel: t.lastUsedAt ? formatDateTime(t.lastUsedAt, timeZone) : null,
    revokedLabel: t.revokedAt ? formatDateTime(t.revokedAt, timeZone) : null,
  }));
}

function requestTime(): Date {
  return new Date();
}

export default async function SettingsPage() {
  const { org, role } = await requireOrgContext();

  if (role !== "owner") {
    return (
      <>
        <PageHeader title="Settings" description="Workspace settings for your team." />
        <EmptyState
          title="Only the owner can change settings"
          description="Ask the workspace owner to update the profile, availability, rubric, forms or webhooks."
        />
      </>
    );
  }

  const base = appBaseUrl();
  const now = requestTime();
  const today = localIsoDate(now, org.timezone);
  const data = await getSettingsData(org.id);
  const limits = limitsFor(org.plan);
  const isPro = org.plan === "pro";

  const forms: HostedFormItem[] = data.forms.map((f) => ({
    id: f.id,
    name: f.name,
    slug: f.slug,
    active: f.active,
    fields: f.fields,
  }));
  const tokens = tokenItems(data.tokens, base, org.timezone);
  const firstEndpoint = tokens.find((t) => t.endpoint)?.endpoint ?? null;

  return (
    <>
      <PageHeader
        title="Settings"
        description="How Firstreply scores, writes and books for you. Each section saves on its own."
        actions={<Pill tone={isPro ? "night" : "outline"}>{isPro ? "Pro plan" : "Free plan"}</Pill>}
      />

      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-8 lg:self-start">
          <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <Link
                  href={`#${s.id}`}
                  className="inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors outline-none hover:border-coral-ink hover:text-coral-ink focus-visible:ring-3 focus-visible:ring-ring/50 lg:flex lg:rounded-lg lg:border-transparent lg:bg-transparent lg:px-2.5 lg:py-1.5 lg:text-sm lg:hover:bg-card"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-12">
          <SettingsSection
            id="profile"
            title="Profile & time zone"
            description="Your business name, booking link and the rules slots are built from."
          >
            <Panel>
              <ProfileForm
                appUrl={base}
                timeZones={timeZoneOptions(org.timezone)}
                values={{
                  name: org.name,
                  timezone: org.timezone,
                  bookingSlug: org.bookingSlug,
                  meetingLengthMinutes: org.meetingLengthMinutes,
                  bufferMinutes: org.bufferMinutes,
                  minNoticeHours: org.minNoticeHours,
                  horizonBusinessDays: org.horizonBusinessDays,
                }}
              />
            </Panel>
          </SettingsSection>

          <SettingsSection
            id="availability"
            title="Availability"
            description="The weekly hours replies offer slots in. Blackout dates override them."
          >
            <div className="grid gap-4">
              <Panel>
                <AvailabilityForm days={groupRules(data.rules)} timezone={org.timezone} />
              </Panel>
              <Panel>
                <h3 className="mb-3 font-heading text-lg">Blackout dates</h3>
                <BlackoutDates items={blackoutItems(data.blackouts, today)} today={today} />
              </Panel>
            </div>
          </SettingsSection>

          <SettingsSection
            id="rubric"
            title="Rubric & offer"
            description="Describe your ideal customer the way you would to a new colleague."
          >
            <Panel>
              <RubricForm rubric={org.rubric} offer={org.offer} />
            </Panel>
          </SettingsSection>

          <SettingsSection
            id="voice"
            title="Voice & signature"
            description="How replies sound and how they are signed."
          >
            <Panel>
              <VoiceForm
                values={{
                  tone: org.voice.tone ?? "",
                  senderName: org.voice.senderName ?? "",
                  signOff: org.voice.signOff ?? "",
                  notes: org.voice.notes ?? "",
                  declineResourceUrl: org.voice.declineResourceUrl ?? "",
                }}
              />
            </Panel>
          </SettingsSection>

          <SettingsSection
            id="autonomy"
            title="Auto-reply"
            description="Decide whether your best-fit leads get an answer without waiting for you."
          >
            <Panel>
              <AutonomyToggle enabled={org.autonomy === "auto_high_score"} isPro={isPro} />
            </Panel>
          </SettingsSection>

          <SettingsSection
            id="forms"
            title="Hosted forms"
            description="A contact form Firstreply hosts for you: share the link or embed it on your site."
          >
            <Panel>
              <HostedForms forms={forms} appUrl={base} activeLimit={limits.forms} />
            </Panel>
          </SettingsSection>

          <SettingsSection
            id="webhooks"
            title="Webhooks"
            description="Keep the form you already have and send its submissions here. Each endpoint URL is a secret: anyone with it can create leads."
          >
            <div className="grid gap-4">
              <Panel>
                <WebhookTokens tokens={tokens} activeLimit={limits.webhookTokens} />
              </Panel>
              <Panel>
                <WebhookGuides endpoint={firstEndpoint} />
              </Panel>
            </div>
          </SettingsSection>
        </div>
      </div>
    </>
  );
}
