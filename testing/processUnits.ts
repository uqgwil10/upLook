import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';
import { type Context, type APIGatewayProxyResult, type APIGatewayEvent } from 'aws-lambda';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Initialize Lambda client
const lambdaClient = new LambdaClient({});

// Table name for units
const UNITS_TABLE = 'units';

// Target Lambda function to invoke
const TARGET_LAMBDA = 'processingLambda';

interface ProcessUnitsEvent {
  amountToProcess: number; // Number of units to process
  dryRun: boolean; // Whether to actually process or just simulate
}

/**
 * Lambda function to process units from DynamoDB
 * @param event - Contains amountToProcess and dryRun parameters
 * @param _context - Lambda context (unused)
 */
export const handler = async (
  event: APIGatewayEvent & ProcessUnitsEvent,
  _context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    // Extract parameters from the event
    const { amountToProcess, dryRun } = event;
    
    if (typeof amountToProcess !== 'number' || amountToProcess <= 0) {
      throw new Error('amountToProcess must be a positive number');
    }
    
    if (typeof dryRun !== 'boolean') {
      throw new Error('dryRun must be a boolean value');
    }
    
    console.log(`Starting processing with amountToProcess=${amountToProcess}, dryRun=${dryRun}`);
    
    // Query DynamoDB for all units
    const scanParams = {
      TableName: UNITS_TABLE,
    };
    
    const scanResult = await docClient.send(new ScanCommand(scanParams));
    const allUnits = scanResult.Items || [];
    
    const totalUnits = allUnits.length;
    const unitsToProcess = Math.min(amountToProcess, totalUnits);
    
    console.log(`Total number of units: ${totalUnits}`);
    console.log(`Number of units to be processed: ${unitsToProcess}`);
    
    // If dryRun is true, trigger another Lambda function
    if (dryRun) {
      console.log('Dry run mode enabled, triggering target Lambda');
      
      // Prepare payload for target Lambda
      const payload = {
        amountToProcess: unitsToProcess,
        units: allUnits.slice(0, unitsToProcess)
      };
      
      const invokeParams = {
        FunctionName: TARGET_LAMBDA,
        InvocationType: InvocationType.Event, // Asynchronous invocation
        Payload: JSON.stringify(payload),
      };
      
      await lambdaClient.send(new InvokeCommand(invokeParams));
      console.log(`Successfully triggered ${TARGET_LAMBDA} Lambda function`);
    } else {
      console.log('Dry run mode disabled, no Lambda will be triggered');
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Processing completed successfully',
        totalUnits,
        unitsToProcess,
        dryRun
      })
    };
  } catch (error) {
    console.error('Error processing units:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error processing units',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}; 