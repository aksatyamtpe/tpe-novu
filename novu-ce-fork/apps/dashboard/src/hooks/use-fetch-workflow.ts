import type { WorkflowResponseDto } from '@novu/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getWorkflow } from '@/api/workflows';
import { useEnvironment } from '@/context/environment/hooks';
import { getIdFromSlug, WORKFLOW_DIVIDER } from '@/utils/id-utils';
import { QueryKeys } from '@/utils/query-keys';
import { coerceOriginForFullCrud } from '@/utils/workflow-crud';

export const useFetchWorkflow = ({ workflowSlug }: { workflowSlug?: string }) => {
  const { currentEnvironment } = useEnvironment();
  const workflowId = useMemo(
    () => getIdFromSlug({ slug: workflowSlug ?? '', divider: WORKFLOW_DIVIDER }),
    [workflowSlug]
  );

  const { data, isPending, error, refetch } = useQuery<WorkflowResponseDto>({
    queryKey: [QueryKeys.fetchWorkflow, currentEnvironment?._id, workflowId],
    queryFn: async () => {
      const wf = await getWorkflow({ environment: currentEnvironment!, workflowSlug });
      // TPE Q2=E: when full-CRUD is enabled, present external/code-first workflows
      // as standard so all downstream gates resolve to "editable / deletable".
      return coerceOriginForFullCrud(wf);
    },
    enabled: !!currentEnvironment?._id && !!workflowSlug,
  });

  return {
    workflow: data,
    isPending,
    error,
    refetch,
  };
};
