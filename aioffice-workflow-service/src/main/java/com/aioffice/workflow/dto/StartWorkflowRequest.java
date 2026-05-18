package com.aioffice.workflow.dto;

import lombok.Data;
import java.util.List;

@Data
public class StartWorkflowRequest {
    private String sourceType;
    private String emailId;
    private String threadId;
    private String subject;
    private String sender;
    private String requesterId;
    private String assignee;
    private String priority;
    private String category;
    private String aiSummary;
    private List<String> attachmentIds;
    private String workspaceId;
}
