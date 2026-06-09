{{/*
Reusable template snippets. `include "lumen.xxx" .` pulls these into the
other template files so names and labels stay consistent.
*/}}

{{/* Short chart name. */}}
{{- define "lumen.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Base resource name — defaults to the release name (e.g. "lumen"). */}}
{{- define "lumen.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Common labels put on every object. */}}
{{- define "lumen.labels" -}}
app.kubernetes.io/name: {{ include "lumen.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Which Secret holds the DB creds — the chart's own, or one you provided. */}}
{{- define "lumen.secretName" -}}
{{- if .Values.db.existingSecret -}}
{{- .Values.db.existingSecret -}}
{{- else -}}
{{- printf "%s-db" (include "lumen.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Hostname the app uses to reach Postgres (bundled service or external). */}}
{{- define "lumen.postgresHost" -}}
{{- if .Values.postgres.enabled -}}
{{- printf "%s-postgres" (include "lumen.fullname" .) -}}
{{- else -}}
{{- required "postgres.enabled is false, so postgres.externalHost must be set" .Values.postgres.externalHost -}}
{{- end -}}
{{- end -}}
