import { DirectionEnum } from '@novu/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getWorkflows } from '@/api/workflows';
import { QueryKeys } from '@/utils/query-keys';
import { coerceWorkflowListForFullCrud } from '@/utils/workflow-crud';
import { useEnvironment } from '../context/environment/hooks';

interface UseWorkflowsParams {
  limit?: number;
  offset?: number;
  query?: string;
  orderBy?: string;
  orderDirection?: DirectionEnum;
  tags?: string[];
  status?: string[];
}

export function useFetchWorkflows({
  limit = 12,
  offset = 0,
  query = '',
  orderBy = '',
  orderDirection = DirectionEnum.DESC,
  tags = [],
  status = [],
}: UseWorkflowsParams = {}) {
  const { currentEnvironment } = useEnvironment();

  const workflowsQuery = useQuery({
    queryKey: [
      QueryKeys.fetchWorkflows,
      currentEnvironment?._id,
      { limit, offset, query, orderBy, orderDirection, tags, status },
    ],
    queryFn: async () => {
      const result = await getWorkflows({
        environment: currentEnvironment!,
        limit,
        offset,
        query,
        orderBy,
        orderDirection,
        tags,
        status,
      });
      // TPE Q2=E: when full-CRUD is enabled, coerce origin EXTERNAL → NOVU_CLOUD_V1
      // for every workflow in the response so the row-level gates (delete, edit,
      // sync) become enabled in the UI.
      return coerceWorkflowListForFullCrud(result);
    },
    placeholderData: keepPreviousData,
    enabled: !!currentEnvironment?._id,
    refetchOnWindowFocus: true,
  });

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = workflowsQuery.data ? Math.ceil(workflowsQuery.data.totalCount / limit) : 0;

  return {
    ...workflowsQuery,
    currentPage,
    totalPages,
  };
}
