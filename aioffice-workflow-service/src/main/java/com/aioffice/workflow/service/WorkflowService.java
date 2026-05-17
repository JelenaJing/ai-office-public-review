package com.aioffice.workflow.service;

import com.aioffice.workflow.dto.CompleteTaskRequest;
import com.aioffice.workflow.dto.StartWorkflowRequest;
import com.aioffice.workflow.dto.WorkflowTaskDto;
import lombok.RequiredArgsConstructor;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.history.HistoricProcessInstance;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class WorkflowService {

    private static final String PROCESS_KEY = "emailOaApproval";

    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final HistoryService historyService;

    public String startEmailWorkflow(StartWorkflowRequest req) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("assignee", req.getAssignee());
        variables.put("subject", req.getSubject());
        variables.put("sender", req.getSender());
        variables.put("requesterId", req.getRequesterId());
        variables.put("priority", req.getPriority());
        variables.put("category", req.getCategory());
        variables.put("aiSummary", req.getAiSummary());
        variables.put("sourceType", req.getSourceType());
        variables.put("emailId", req.getEmailId());
        variables.put("threadId", req.getThreadId());
        variables.put("workspaceId", req.getWorkspaceId());
        if (req.getAttachmentIds() != null) {
            variables.put("attachmentIds", String.join(",", req.getAttachmentIds()));
        }

        String businessKey = "email:" + req.getEmailId();
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(PROCESS_KEY, businessKey, variables);
        return instance.getId();
    }

    public List<WorkflowTaskDto> getMyTasks(String assignee) {
        List<Task> tasks = taskService.createTaskQuery()
                .processDefinitionKey(PROCESS_KEY)
                .taskAssignee(assignee)
                .orderByTaskCreateTime().desc()
                .list();

        return tasks.stream().map(task -> {
            WorkflowTaskDto dto = new WorkflowTaskDto();
            dto.setTaskId(task.getId());
            dto.setTaskName(task.getName());
            dto.setProcessInstanceId(task.getProcessInstanceId());
            dto.setAssignee(task.getAssignee());
            dto.setCreateTime(task.getCreateTime());

            ProcessInstance pi = runtimeService.createProcessInstanceQuery()
                    .processInstanceId(task.getProcessInstanceId())
                    .singleResult();
            if (pi != null) {
                dto.setBusinessKey(pi.getBusinessKey());
            }

            Map<String, Object> vars = taskService.getVariables(task.getId());
            dto.setSubject((String) vars.get("subject"));
            dto.setSender((String) vars.get("sender"));
            dto.setPriority((String) vars.get("priority"));
            dto.setCategory((String) vars.get("category"));
            dto.setAiSummary((String) vars.get("aiSummary"));
            return dto;
        }).collect(Collectors.toList());
    }

    public void completeTask(String taskId, CompleteTaskRequest req) {
        Map<String, Object> variables = new HashMap<>();
        variables.put("decision", req.getDecision());
        variables.put("comment", req.getComment());
        variables.put("operatorId", req.getOperatorId());
        taskService.complete(taskId, variables);
    }

    public Map<String, Object> getProcessInstance(String processInstanceId) {
        Map<String, Object> result = new HashMap<>();

        ProcessInstance pi = runtimeService.createProcessInstanceQuery()
                .processInstanceId(processInstanceId)
                .singleResult();

        if (pi != null) {
            result.put("processInstanceId", pi.getId());
            result.put("businessKey", pi.getBusinessKey());
            result.put("processDefinitionKey", pi.getProcessDefinitionKey());
            result.put("status", "active");
            result.put("variables", runtimeService.getVariables(processInstanceId));
        } else {
            HistoricProcessInstance hpi = historyService.createHistoricProcessInstanceQuery()
                    .processInstanceId(processInstanceId)
                    .singleResult();
            if (hpi != null) {
                result.put("processInstanceId", hpi.getId());
                result.put("businessKey", hpi.getBusinessKey());
                result.put("processDefinitionKey", hpi.getProcessDefinitionKey());
                result.put("status", hpi.getEndTime() != null ? "completed" : "active");
                result.put("startTime", hpi.getStartTime());
                result.put("endTime", hpi.getEndTime());
            } else {
                result.put("error", "Process instance not found: " + processInstanceId);
            }
        }
        return result;
    }
}
