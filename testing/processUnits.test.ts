/**
 * Tests for the processUnits Lambda function
 * 
 * To run these tests, you need to install the following dependencies:
 * npm install --save-dev aws-sdk-client-mock @types/jest jest
 * npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-lambda aws-lambda
 */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { handler } from './processUnits';

// Mock the DynamoDB and Lambda clients
const ddbMock = mockClient(DynamoDBClient);
const lambdaMock = mockClient(LambdaClient);

// Mock console methods for testing
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
let consoleOutput: string[] = [];

describe('processUnits Lambda', () => {
  beforeEach(() => {
    // Reset mocks before each test
    ddbMock.reset();
    lambdaMock.reset();
    
    // Mock console methods to capture output
    consoleOutput = [];
    console.log = jest.fn((...args) => {
      consoleOutput.push(args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : arg
      ).join(' '));
    });
    console.error = jest.fn((...args) => {
      consoleOutput.push(args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : arg
      ).join(' '));
    });
  });
  
  afterAll(() => {
    // Restore original console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });
  
  test('should process units and log counts with dryRun=false', async () => {
    // Mock DynamoDB response
    const mockUnits = [
      { id: '1', name: 'Unit 1', status: 'active' },
      { id: '2', name: 'Unit 2', status: 'inactive' },
      { id: '3', name: 'Unit 3', status: 'active' }
    ];
    
    ddbMock.on(ScanCommand).resolves({
      Items: mockUnits,
      Count: mockUnits.length
    });
    
    // Execute the handler with dryRun=false
    const event = {
      amountToProcess: 2,
      dryRun: false
    };
    
    const result = await handler(event as any, {} as any);
    
    // Verify the result
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalUnits).toBe(3);
    expect(body.unitsToProcess).toBe(2);
    expect(body.dryRun).toBe(false);
    
    // Verify logs
    expect(consoleOutput.some(log => log.includes('Total number of units: 3'))).toBe(true);
    expect(consoleOutput.some(log => log.includes('Number of units to be processed: 2'))).toBe(true);
    expect(consoleOutput.some(log => log.includes('Dry run mode disabled'))).toBe(true);
    
    // Verify Lambda was not invoked
    expect(lambdaMock.calls().length).toBe(0);
  });
  
  test('should process units and trigger target Lambda with dryRun=true', async () => {
    // Mock DynamoDB response
    const mockUnits = [
      { id: '1', name: 'Unit 1', status: 'active' },
      { id: '2', name: 'Unit 2', status: 'inactive' },
      { id: '3', name: 'Unit 3', status: 'active' },
      { id: '4', name: 'Unit 4', status: 'active' }
    ];
    
    ddbMock.on(ScanCommand).resolves({
      Items: mockUnits,
      Count: mockUnits.length
    });
    
    // Mock Lambda invocation
    lambdaMock.on(InvokeCommand).resolves({});
    
    // Execute the handler with dryRun=true
    const event = {
      amountToProcess: 3,
      dryRun: true
    };
    
    const result = await handler(event as any, {} as any);
    
    // Verify the result
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalUnits).toBe(4);
    expect(body.unitsToProcess).toBe(3);
    expect(body.dryRun).toBe(true);
    
    // Verify logs
    expect(consoleOutput.some(log => log.includes('Total number of units: 4'))).toBe(true);
    expect(consoleOutput.some(log => log.includes('Number of units to be processed: 3'))).toBe(true);
    expect(consoleOutput.some(log => log.includes('Dry run mode enabled'))).toBe(true);
    
    // Verify Lambda was invoked with correct parameters
    expect(lambdaMock.calls().length).toBe(1);
    const lambdaCall = lambdaMock.call(0);
    expect(lambdaCall.args[0].input.FunctionName).toBe('processingLambda');
    
    // Verify payload contains expected data
    const payload = JSON.parse(lambdaCall.args[0].input.Payload as string);
    expect(payload.amountToProcess).toBe(3);
    expect(payload.units.length).toBe(3);
  });
  
  test('should handle error cases - invalid amountToProcess', async () => {
    // Execute the handler with invalid amountToProcess
    const event = {
      amountToProcess: -1,
      dryRun: true
    };
    
    const result = await handler(event as any, {} as any);
    
    // Verify error result
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Error processing units');
    expect(body.error).toBe('amountToProcess must be a positive number');
  });
  
  test('should handle error cases - invalid dryRun', async () => {
    // Execute the handler with invalid dryRun
    const event = {
      amountToProcess: 5,
      dryRun: 'not-a-boolean'
    };
    
    const result = await handler(event as any, {} as any);
    
    // Verify error result
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Error processing units');
    expect(body.error).toBe('dryRun must be a boolean value');
  });
  
  test('should process units with amountToProcess greater than available units', async () => {
    // Mock DynamoDB response with fewer units than requested
    const mockUnits = [
      { id: '1', name: 'Unit 1', status: 'active' },
      { id: '2', name: 'Unit 2', status: 'inactive' }
    ];
    
    ddbMock.on(ScanCommand).resolves({
      Items: mockUnits,
      Count: mockUnits.length
    });
    
    // Execute the handler with amountToProcess greater than available units
    const event = {
      amountToProcess: 10,
      dryRun: false
    };
    
    const result = await handler(event as any, {} as any);
    
    // Verify the result
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalUnits).toBe(2);
    expect(body.unitsToProcess).toBe(2); // Should be limited to available units
    
    // Verify logs
    expect(consoleOutput.some(log => log.includes('Total number of units: 2'))).toBe(true);
    expect(consoleOutput.some(log => log.includes('Number of units to be processed: 2'))).toBe(true);
  });
}); 