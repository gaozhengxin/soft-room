import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GatewayHealth,firstAcknowledged} from '../src/gateway-health.ts';
test('one acknowledged gateway suffices; losing a spare does not mark the room offline',()=>{
 const health=new GatewayHealth();health.acknowledge('a','a1',0);health.acknowledge('b','b1',0);
 assert.deepEqual(health.available(new Map([['a','a1']]),1),['a']);health.drop('b');assert.deepEqual(health.available(new Map([['a','a1']]),1),['a']);
 assert.deepEqual(health.available(new Map([['a','a2']]),1),[]);assert.deepEqual(health.available(new Map([['a','a1']]),35000),[]);
 health.acknowledge('a','a2',35000);health.drop('a','a1');assert.deepEqual(health.available(new Map([['a','a2']]),35001),['a']);health.clear();assert.deepEqual(health.available(new Map([['a','a2']]),35001),[]);
});
test('an acknowledgement wins without waiting for a stalled or rejected backup',async()=>{
 const result=await firstAcknowledged([new Promise<boolean>(()=>{}),Promise.resolve(false),Promise.resolve(true)],Boolean);assert.equal(result,true);
 await assert.rejects(firstAcknowledged([Promise.resolve(false),Promise.reject(Error('Offline'))],Boolean));
});
