function diffArrays(oldArr, newArr, key = 'id') {
  const oldMap = new Map(oldArr.map(item => [item[key], item]));
  const added = [];
  const modified = [];
  const deleted = [];
  
  newArr.forEach(item => {
    if (!oldMap.has(item[key])) added.push(item);
    else {
      const oldItem = oldMap.get(item[key]);
      if (JSON.stringify(oldItem) !== JSON.stringify(item)) modified.push(item);
      oldMap.delete(item[key]);
    }
  });
  oldMap.forEach(item => deleted.push(item));
  return { added, modified, deleted };
}
const oldArr = [{id: 1, active: true}, {id: 2, active: true}];
const newArr = [{id: 1, active: true}, {id: 2, active: false}];
console.log(diffArrays(oldArr, newArr));
