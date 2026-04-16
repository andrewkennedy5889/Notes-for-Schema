import React, { useState, useEffect, useCallback } from "react";

interface DepFeature {
  featureId: number;
  featureName: string;
  status: string;
  priority: string;
  dependencies: number[];
}

interface DepTest {
  testId: number;
  featureId: number;
  title: string;
  testType: string;
  status: string;
  dependencies: number[];
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: "#e05555",
  High: "#e67d4a",
  Medium: "#f2b661",
  Low: "#9999b3",
  "N/A": "#666680",
};

const STATUS_COLORS: Record<string, string> = {
  Idea: "#9999b3",
  Approved: "#5bc0de",
  "Partially Implemented": "#f2b661",
  Implemented: "#4ecb71",
};

const TEST_STATUS_COLORS: Record<string, string> = {
  draft: "#9999b3",
  ready: "#5bc0de",
  passing: "#4ecb71",
  failing: "#e05555",
  skipped: "#666680",
};

const TEST_TYPE_COLORS: Record<string, string> = {
  unit: "#4ecb71",
  integration: "#5bc0de",
  e2e: "#a855f7",
  acceptance: "#f2b661",
};

interface Props {
  featureId: number;
  onNavigateToFeature?: (featureId: number) => void;
}

export default function DependedOnBySection({ featureId, onNavigateToFeature }: Props) {
  const [dependents, setDependents] = useState<Array<{
    feature: DepFeature;
    crossTests: DepTest[];
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [expandedFeatureId, setExpandedFeatureId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [featRes, testRes] = await Promise.all([
        fetch("/api/schema-planner?table=_splan_features"),
        fetch("/api/schema-planner?table=_splan_feature_tests"),
      ]);
      if (!featRes.ok || !testRes.ok) { setLoading(false); return; }

      const featData = await featRes.json();
      const testData = await testRes.json();

      const allFeats: DepFeature[] = (Array.isArray(featData) ? featData : featData.rows || []) as DepFeature[];
      const allTests: DepTest[] = (Array.isArray(testData) ? testData : testData.rows || []) as DepTest[];

      // Features that list this featureId in their dependencies
      const depFeatures = allFeats.filter(
        (f) => f.featureId !== featureId && Array.isArray(f.dependencies) && f.dependencies.includes(featureId)
      );

      // Tests from ANY feature that list this featureId in their dependencies
      const crossTests = allTests.filter(
        (t) => Array.isArray(t.dependencies) && t.dependencies.includes(featureId)
      );

      // Group by parent feature
      const depFeatureIds = new Set(depFeatures.map((f) => f.featureId));
      const result: Array<{ feature: DepFeature; crossTests: DepTest[] }> = depFeatures.map((f) => ({
        feature: f,
        crossTests: crossTests.filter((t) => t.featureId === f.featureId),
      }));

      // Also include features that only have test-level deps (no feature-level dep)
      const extraFeatureIds = new Set(
        crossTests.filter((t) => !depFeatureIds.has(t.featureId) && t.featureId !== featureId).map((t) => t.featureId)
      );
      for (const fid of extraFeatureIds) {
        const feat = allFeats.find((f) => f.featureId === fid);
        if (feat) {
          result.push({
            feature: feat,
            crossTests: crossTests.filter((t) => t.featureId === fid),
          });
        }
      }

      setDependents(result);
    } catch { /* ignore */ }
    setLoading(false);
  }, [featureId]);

  useEffect(() => { load(); }, [load]);

  if (loading || dependents.length === 0) return null;

  const navigate = (fid: number) => {
    if (onNavigateToFeature) {
      onNavigateToFeature(fid);
    } else {
      // Fallback: switch to features tab with that feature
      const params = new URLSearchParams(window.location.search);
      params.set("sptab", "features");
      window.history.pushState({}, "", `?${params.toString()}`);
      window.location.reload();
    }
  };

  return (
    <div>
      <label className="font-semibold block mb-2" style={{ color: "var(--color-text-muted)" }}>
        Depended On By
      </label>
      <div className="space-y-2">
        {dependents.map(({ feature, crossTests }) => {
          const isExpanded = expandedFeatureId === feature.featureId;
          return (
            <div key={feature.featureId}>
              <div
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: "rgba(66,139,202,0.06)", border: "1px solid rgba(66,139,202,0.15)" }}
              >
                {/* Clickable feature name */}
                <button
                  onClick={() => navigate(feature.featureId)}
                  className="font-medium hover:underline cursor-pointer"
                  style={{ color: "#5bc0de" }}
                  title={`Navigate to ${feature.featureName}`}
                >
                  {feature.featureName}
                </button>
                <span
                  className="px-1.5 py-0 rounded-full text-[10px] font-medium"
                  style={{ backgroundColor: "rgba(0,0,0,0.2)", color: STATUS_COLORS[feature.status] ?? "#888" }}
                >
                  {feature.status}
                </span>
                <span
                  className="px-1.5 py-0 rounded-full text-[10px] font-medium"
                  style={{ backgroundColor: "rgba(0,0,0,0.2)", color: PRIORITY_COLORS[feature.priority] ?? "#888" }}
                >
                  {feature.priority}
                </span>
                {crossTests.length > 0 && (
                  <button
                    onClick={() => setExpandedFeatureId(isExpanded ? null : feature.featureId)}
                    className="text-[10px] hover:underline cursor-pointer"
                    style={{ color: "#5bc0de" }}
                  >
                    — {crossTests.length} cross-feature test{crossTests.length !== 1 ? "s" : ""} {isExpanded ? "▾" : "▸"}
                  </button>
                )}
              </div>

              {/* Expanded cross-feature tests */}
              {isExpanded && crossTests.length > 0 && (
                <div className="ml-4 mt-1 mb-1 space-y-1">
                  {crossTests.map((t) => (
                    <div
                      key={t.testId}
                      className="flex items-center gap-2 px-3 py-1.5 rounded text-[10px]"
                      style={{ backgroundColor: "rgba(66,139,202,0.03)", border: "1px solid rgba(66,139,202,0.08)" }}
                    >
                      <span
                        className="px-1.5 py-0 rounded-full font-medium capitalize"
                        style={{ color: TEST_TYPE_COLORS[t.testType] ?? "#888", backgroundColor: "rgba(0,0,0,0.15)" }}
                      >
                        {t.testType}
                      </span>
                      <span style={{ color: "var(--color-text)" }}>{t.title}</span>
                      <span
                        className="px-1.5 py-0 rounded-full font-medium ml-auto"
                        style={{ color: TEST_STATUS_COLORS[t.status] ?? "#888", backgroundColor: "rgba(0,0,0,0.15)" }}
                      >
                        {t.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
