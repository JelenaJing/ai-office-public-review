package com.aioffice.workflow.controller;

import com.aioffice.workflow.dto.CompleteTaskRequest;
import com.aioffice.workflow.dto.StartWorkflowRequest;
import com.aioffice.workflow.dto.WorkflowTaskDto;
import com.aioffice.workflow.service.WorkflowService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/workflows")
@RequiredArgsConstructor
public class WorkflowController {

    private final WorkflowService workflowService;

    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        Map<String, String> result = new HashMap<>();
        result.put("status", "ok");
        result.put("service", "aioffice-workflow-service");
        return ResponseEntity.ok(result);
    }

    @PostMapping("/email/start")
    public ResponseEntity<Map<String, String>> startEmailWorkflow(@RequestBody StartWorkflowRequest request) {
        String processInstanceId = workflowService.startEmailWorkflow(request);
        Map<String, String> result = new HashMap<>();
        result.put("processInstanceId", processInstanceId);
        result.put("status", "started");
        return ResponseEntity.ok(result);
    }

    @GetMapping("/tasks/my")
    public ResponseEntity<List<WorkflowTaskDto>> getMyTasks(@RequestParam String assignee) {
        return ResponseEntity.ok(workflowService.getMyTasks(assignee));
    }

    @PostMapping("/tasks/{taskId}/complete")
    public ResponseEntity<Map<String, String>> completeTask(
            @PathVariable String taskId,
            @RequestBody CompleteTaskRequest request) {
        workflowService.completeTask(taskId, request);
        Map<String, String> result = new HashMap<>();
        result.put("taskId", taskId);
        result.put("status", "completed");
        result.put("decision", request.getDecision());
        return ResponseEntity.ok(result);
    }

    @GetMapping("/instances/{processInstanceId}")
    public ResponseEntity<Map<String, Object>> getProcessInstance(@PathVariable String processInstanceId) {
        return ResponseEntity.ok(workflowService.getProcessInstance(processInstanceId));
    }
}
