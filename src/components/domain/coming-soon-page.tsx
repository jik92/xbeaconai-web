import { Clock3 } from "lucide-react";
import type { AssetFeatureId } from "@/app/config";
import { APP_CONFIG } from "@/app/config";
import type { ModuleConfig } from "@/app/routes";

type ComingSoonFeature = Pick<ModuleConfig, "id" | "label"> | { id: AssetFeatureId; label: string };

export function ComingSoonPage({ config }: { config: ComingSoonFeature }) {
  return (
    <section className="coming-soon-page" data-module-id={config.id}>
      <div className="coming-soon-icon">
        <Clock3 />
      </div>
      <span>COMING SOON</span>
      <h1>{config.label}</h1>
      <p>该工作流正在逐项验收，验收通过后会在这里开放。</p>
      <small>当前不会创建任务、扣除创作点或调用任何模型。</small>
    </section>
  );
}

export function ProjectComingSoonPage() {
  return (
    <section className="coming-soon-page" data-module-id="project">
      <div className="coming-soon-icon">
        <Clock3 />
      </div>
      <span>COMING SOON</span>
      <h1>{APP_CONFIG.projectName}</h1>
      <p>功能正在逐项验收，开放后会在这里显示。</p>
      <small>当前不会创建任务、扣除创作点或调用任何模型。</small>
    </section>
  );
}
