package com.aioffice.workflow.dto;

import lombok.Data;

@Data
public class CompleteTaskRequest {
    /** approve 或 reject */
    private String decision;
    private String comment;
    private String operatorId;
}
