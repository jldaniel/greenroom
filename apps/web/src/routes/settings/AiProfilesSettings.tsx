import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Brain, Check, LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

import type { ProfileId, ProviderKind } from "@greenroom/schemas";

import type { GreenroomApiTokenStatus } from "../../api/client";
import {
  useCreateProfile,
  useDeleteProfile,
  useHarnessModels,
  useHarnessStatus,
  useProfiles,
  useUpdateProfile,
} from "../../api/hooks";
import { ApiErrorBanner, LoadingBlock } from "../../components/Feedback";
import {
  newProfileFormState,
  profileFormStateFromProfile,
  profileInputFromFormState,
  type ProfileFormState,
} from "./profileFormUtils";
import { ProfileFormFields } from "./ProfileFormFields";
import {
  defaultModelFromCatalog,
  harnessKindOptionsFromStatus,
  harnessKindOptionsWithCurrent,
  reasoningLevelSupported,
} from "./settingsUtils";

/**
 * AI Profiles section: common profile properties edit as real form
 * fields; the raw modelSettings/contextPreferences JSON stays behind the
 * Advanced disclosure for every provider.
 */
export function AiProfilesSettings({ tokenStatus }: { tokenStatus: GreenroomApiTokenStatus }) {
  const enabled = tokenStatus.source !== "missing";
  const harnessStatus = useHarnessStatus(enabled);
  const harnessKindOptions = useMemo(
    () => harnessKindOptionsFromStatus(harnessStatus.data),
    [harnessStatus.data],
  );
  const profiles = useProfiles(enabled);
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const deleteProfile = useDeleteProfile();
  const [selectedProfileId, setSelectedProfileId] = useState<ProfileId | "new">("new");
  const selectedProfile =
    selectedProfileId === "new"
      ? null
      : (profiles.data?.find((profile) => profile.id === selectedProfileId) ?? null);
  const defaultHarnessKind = harnessKindOptions[0]?.kind ?? "";
  const [form, setForm] = useState<ProfileFormState>(() =>
    newProfileFormState({ harnessKind: "", defaultModel: "claude-code" }),
  );
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const harnessModels = useHarnessModels(
    form.provider === "harness" && form.harnessKind.trim().length > 0 ? form.harnessKind : null,
    enabled,
  );

  function setField<Key extends keyof ProfileFormState>(key: Key, value: ProfileFormState[Key]) {
    setSaveStatus("idle");
    setForm((current) => ({ ...current, [key]: value }));
  }

  useEffect(() => {
    if (profiles.data === undefined || selectedProfileId !== "new") {
      return;
    }

    const firstTeachingProfile =
      profiles.data.find((profile) => profile.workflowType === "teaching") ?? profiles.data[0];

    if (firstTeachingProfile !== undefined) {
      setSelectedProfileId(firstTeachingProfile.id);
    }
  }, [profiles.data, selectedProfileId]);

  useEffect(() => {
    if (
      form.provider !== "harness" ||
      form.harnessKind.trim().length > 0 ||
      defaultHarnessKind.length === 0
    ) {
      return;
    }

    const option = harnessKindOptions.find((candidate) => candidate.kind === defaultHarnessKind);
    setSaveStatus("idle");
    setForm((current) => ({
      ...current,
      harnessKind: defaultHarnessKind,
      model: option?.defaultModel ?? defaultHarnessKind,
      reasoningLevel: "",
    }));
  }, [defaultHarnessKind, form.harnessKind, form.provider, harnessKindOptions]);

  useEffect(() => {
    if (
      selectedProfileId !== "new" ||
      form.provider !== "harness" ||
      harnessModels.data === undefined
    ) {
      return;
    }

    if (form.model.trim().length > 0 && form.model !== form.harnessKind) {
      return;
    }

    const nextModel = defaultModelFromCatalog(harnessModels.data, form.model);

    if (nextModel !== form.model) {
      setField("model", nextModel);
    }
  }, [form.harnessKind, form.model, form.provider, harnessModels.data, selectedProfileId]);

  useEffect(() => {
    if (selectedProfile === null) {
      return;
    }

    setForm(profileFormStateFromProfile(selectedProfile, harnessKindOptions));
    setShowAdvancedJson(false);
    setFormError(null);
  }, [harnessKindOptions, selectedProfile]);

  function startNewProfile() {
    setSelectedProfileId("new");
    setForm(
      newProfileFormState({
        harnessKind: defaultHarnessKind,
        defaultModel:
          harnessKindOptions.find((option) => option.kind === defaultHarnessKind)?.defaultModel ??
          "claude-code",
      }),
    );
    setShowAdvancedJson(false);
    setFormError(null);
    setSaveStatus("idle");
    createProfile.reset();
    updateProfile.reset();
  }

  function selectProfile(profileId: ProfileId) {
    setSelectedProfileId(profileId);
    setSaveStatus("idle");
    createProfile.reset();
    updateProfile.reset();
  }

  function handleProviderChange(nextProvider: ProviderKind) {
    setField("provider", nextProvider);

    if (nextProvider !== "harness") {
      return;
    }

    const nextKind = form.harnessKind.trim().length > 0 ? form.harnessKind : defaultHarnessKind;
    const option = harnessKindOptions.find((candidate) => candidate.kind === nextKind);

    if (nextKind.length > 0) {
      setForm((current) => ({
        ...current,
        provider: nextProvider,
        harnessKind: nextKind,
        model: option?.defaultModel ?? nextKind,
        reasoningLevel: "",
      }));
    }
  }

  function handleHarnessKindChange(nextKind: string) {
    const option = harnessKindOptions.find((candidate) => candidate.kind === nextKind);
    setSaveStatus("idle");
    setForm((current) => ({
      ...current,
      harnessKind: nextKind,
      model: option?.defaultModel ?? nextKind,
      reasoningLevel: "",
    }));
  }

  function handleModelChange(nextModel: string) {
    setSaveStatus("idle");
    setForm((current) => ({
      ...current,
      model: nextModel,
      reasoningLevel: reasoningLevelSupported(harnessModels.data, nextModel, current.reasoningLevel)
        ? current.reasoningLevel
        : "",
    }));
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaveStatus("idle");

    const result = profileInputFromFormState(form);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    try {
      if (selectedProfileId === "new") {
        const created = await createProfile.mutateAsync(result.input);
        setSelectedProfileId(created.id);
      } else {
        await updateProfile.mutateAsync({ profileId: selectedProfileId, input: result.input });
      }

      setSaveStatus("saved");
    } catch {
      // The mutation error renders in the alert above the form.
    }
  }

  async function handleDeleteProfile() {
    if (selectedProfileId === "new") {
      return;
    }

    await deleteProfile.mutateAsync(selectedProfileId);
    startNewProfile();
  }

  const mutationError = createProfile.error ?? updateProfile.error ?? deleteProfile.error;
  const isSaving = createProfile.isPending || updateProfile.isPending;
  const isSaveDisabled =
    !enabled ||
    isSaving ||
    form.name.trim().length === 0 ||
    form.model.trim().length === 0 ||
    (form.provider === "harness" && form.harnessKind.trim().length === 0);
  const visibleHarnessKindOptions = useMemo(
    () => harnessKindOptionsWithCurrent(harnessKindOptions, form.harnessKind),
    [form.harnessKind, harnessKindOptions],
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-normal">Profiles</h2>
          <p className="text-sm text-muted">{profiles.data?.length ?? 0} configured</p>
        </div>
        <button
          type="button"
          onClick={startNewProfile}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-muted-surface"
        >
          <Plus aria-hidden="true" className="size-4" />
          New
        </button>
      </div>

      {profiles.isLoading ? <LoadingBlock label="Loading profiles" /> : null}
      {profiles.error === null ? null : <ApiErrorBanner error={profiles.error} />}
      {mutationError === null ? null : <ApiErrorBanner error={mutationError} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-lg border border-line bg-surface p-3">
          <div className="space-y-2">
            <button
              type="button"
              onClick={startNewProfile}
              className={profileListButtonClassName(selectedProfileId === "new")}
            >
              <Plus aria-hidden="true" className="size-4" />
              New profile
            </button>
            {profiles.data?.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => selectProfile(profile.id)}
                className={profileListButtonClassName(selectedProfileId === profile.id)}
              >
                <Brain aria-hidden="true" className="size-4" />
                <span className="min-w-0 flex-1 truncate text-left">{profile.name}</span>
              </button>
            ))}
          </div>
        </div>

        <form
          className="min-w-0 rounded-lg border border-line bg-surface p-4"
          onSubmit={(event) => void handleSaveProfile(event)}
        >
          <ProfileFormFields
            form={form}
            formError={formError}
            onFieldChange={setField}
            onHarnessKindChange={handleHarnessKindChange}
            onHarnessModelsRetry={() => void harnessModels.refetch()}
            onModelChange={handleModelChange}
            onProviderChange={handleProviderChange}
            selectedProfile={selectedProfile}
            showAdvancedJson={showAdvancedJson}
            onToggleAdvancedJson={() => setShowAdvancedJson((current) => !current)}
            visibleHarnessKindOptions={visibleHarnessKindOptions}
            harnessModelCatalog={harnessModels.data}
            harnessModelsError={harnessModels.error !== null}
            harnessModelsLoading={harnessModels.isLoading}
          />

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="min-h-5 flex-1 text-sm" aria-live="polite" role="status">
              {isSaving ? (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  Saving profile…
                </span>
              ) : saveStatus === "saved" ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-success-ink">
                  <Check aria-hidden="true" className="size-4" />
                  Profile saved.
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void handleDeleteProfile()}
              disabled={selectedProfileId === "new" || deleteProfile.isPending}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-danger/30 bg-surface px-3 text-sm font-medium text-danger-ink hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete
            </button>
            <button
              type="submit"
              disabled={isSaveDisabled}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-ink bg-ink px-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              {isSaving ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Save aria-hidden="true" className="size-4" />
              )}
              {isSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function profileListButtonClassName(active: boolean): string {
  return `flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm ${
    active ? "bg-accent-soft text-accent-ink" : "text-muted hover:bg-muted-surface hover:text-ink"
  }`;
}
