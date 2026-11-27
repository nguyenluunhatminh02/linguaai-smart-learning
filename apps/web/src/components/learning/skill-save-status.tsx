import { Button } from '@/components/ui/button';
import type { SkillCompletion, useSkillCompletion } from '@/hooks/use-skill-completion';

export function SkillSaveStatus({ progress, activity }: {
  progress: ReturnType<typeof useSkillCompletion>;
  activity: SkillCompletion;
}) {
  if (progress.variables?.activityId !== activity.activityId) return null;
  if (progress.isPending) return <p className="mt-2 text-sm" role="status">Đang lưu tiến độ…</p>;
  if (progress.isSuccess) return <p className="mt-2 text-sm" role="status">Đã lưu tiến độ.</p>;
  if (progress.isError) return (
    <div className="mt-2 space-y-2">
      <p className="text-sm" role="alert">Chưa lưu được tiến độ.</p>
      <Button variant="outline" size="sm" onClick={() => progress.mutate(activity)}>Thử lưu lại</Button>
    </div>
  );
  return null;
}
