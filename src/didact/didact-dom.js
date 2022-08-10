// constant
let nextUnitOfWork = null;
let wipRoot = null;
let currentRoot = null;
let deletions = null;
let wipFiber = null; // workInProgressFiber
let hookIndex = null;

// util function
const isEvent = key => key.startsWith("on");
const isProperty = key =>
  key !== "children" && !isEvent(key);
const isNew = (prev, next) => key =>
  prev[key] !== next[key];
const isGone = (prev, next) => key => !(key in next);
const isEqualArray = (prev, next) => JSON.stringify(prev) === JSON.stringify(next);

const transFormCamelCase = (str) => {
  let reg = /[A-Z]/g;
  let matchArr = str.match(reg);
  if (matchArr) {
    for (let i of matchArr) {
      str = str.replace(i, `-${i.toLowerCase()}`);
    }
  }
  return str;
};


function removeEvent(dom, prevProps, nextProps) {
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(key => !(key in nextProps) || isNew(prevProps, nextProps)(key))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2);
      dom.removeEventListener(eventType, prevProps[name]);
    });
}

function addEvent(dom, prevProps, nextProps) {
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name
        .toLowerCase()
        .substring(2);
      dom.addEventListener(
        eventType,
        nextProps[name]
      );
    });
}

function transformStyle(nextProps, name) {
  let styleString = '';
  Object.keys(nextProps[name]).forEach(key => {
    let value = nextProps[name][key];
    if (typeof value === 'number') {
      value += 'px';
    }
    styleString += `${transFormCamelCase(key)}:${value};`;
  });
  return styleString;
}

function updateDom(dom, prevProps, nextProps) {
  removeEvent(dom, prevProps, nextProps);
  addEvent(dom, prevProps, nextProps);

  // Remove old properties
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = "";
    });

  // Set new or changed properties
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      if (name === 'style') { // 支持style属性
        dom[name] = transformStyle(nextProps, name);
      } else {
        dom[name] = nextProps[name];
      }
    });
}

function dispatchSingleEffect(wipFiber, _hookIndex) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[_hookIndex];
  const hook = wipFiber && wipFiber.hooks && wipFiber.hooks[_hookIndex];

  if (oldHook && hook) {
    if (!isEqualArray(oldHook.deps, hook.deps) || !oldHook.deps || !hook.deps) {
      return hook.handler();
    }
  } else if (!oldHook && hook) { // mount 阶段
    return hook.handler();
  }
  return () => { };
}

// 处理所有的useEffect
function dealWithAllEffect(wipFiber) {
  const hooks = (wipFiber && wipFiber.hooks) || [];
  for (let i = 0; i < hooks.length; i++) {
    if (hooks[i].handler) { // 确保是useEffect
      const callback = dispatchSingleEffect(wipFiber, i);
      if (wipFiber.effectTag === "DELETION" && typeof callback === 'function') {
        callback();
      }
    }
  }
}

function commitRoot() {
  deletions.forEach(commitWork);
  commitWork(wipRoot.child);
  currentRoot = wipRoot;
  wipRoot = null;
}

// 更新页面上的dom
function commitWork(fiber) {
  if (!fiber) {
    return;
  }

  let domParentFiber = fiber.parent;

  // 因为有function component存在 所以要向上找到存在dom的fiber
  // 函数组件对应一个 Fiber 节点，但其没有对应的 DOM 节点。因此在 commit 阶段进行DOM操作需要找到真正的父子节点。
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent;
  }
  const domParent = domParentFiber.dom;

  if (
    fiber.effectTag === "PLACEMENT" &&
    fiber.dom != null
  ) {
    addEvent(fiber.dom, {}, fiber.props); // fix:添加事件
    domParent.appendChild(fiber.dom);
  } else if (
    fiber.effectTag === "UPDATE" &&
    fiber.dom != null
  ) {
    updateDom(
      fiber.dom,
      fiber.alternate.props,
      fiber.props
    );
  } else if (fiber.effectTag === "DELETION") {
    commitDeletion(fiber, domParent);
  }

  dealWithAllEffect(fiber);

  // 由于commitWork push进来的是oldFiber，所以这个oldFiber上的child存在effectTag
  // 导致执行 deletions.forEach(commitWork) 的时候会去commitWork这个oldFiber的child和sibling（which has the last effectTag）
  // 所以需要手动清除effectTag
  fiber.effectTag = ''; // fix:清除effectTag

  commitWork(fiber.child);
  commitWork(fiber.sibling);
}

function commitDeletion(fiber, domParent) {
  let prevProps = fiber.alternate ? fiber.alternate.props : {};

  if (fiber.dom) {
    removeEvent(fiber.dom, prevProps, {}); //fix:解绑事件
    domParent.removeChild(fiber.dom);
  } else {
    commitDeletion(fiber.child, domParent);
  }
}

function workLoop(deadline) {
  let shouldYield = false;
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(
      nextUnitOfWork
    );
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRoot) {
    commitRoot();
  }
  // 继续监听
  requestIdleCallback(workLoop);
}

// 根据fiber.props.children形成fiber tree
function reconcileChildren(wipFiber, elements) {
  let index = 0;
  let prevSibling = null;

  let oldFiber = wipFiber.alternate && wipFiber.alternate.child;

  // 形成单向链表
  while (index < elements.length ||
    oldFiber != null // 删除节点的情况
  ) {
    const element = elements[index];
    let newFiber = null;

    const sameType =
      oldFiber &&
      element &&
      element.type === oldFiber.type;

    if (sameType) { // update
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: "UPDATE",
      };
    }
    if (element && !sameType) { // add
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      };
    }
    if (oldFiber && !sameType) { // delete
      oldFiber.effectTag = "DELETION";
      deletions.push(oldFiber);
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling;
    }

    if (index === 0) {
      wipFiber.child = newFiber;
    } else if (element) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    index++;
  }
}

function completeWork(fiber) {
  if (!fiber) {
    return;
  }
  // todo move "create dom and appendTo parent" to here
}

function updateFunctionComponent(fiber) {
  wipFiber = fiber;
  hookIndex = 0;
  wipFiber.hooks = [];
  const children = [fiber.type(fiber.props)];
  reconcileChildren(fiber, children.flat()); // 注意：这里函数组件的fiber是没有dom的
}

function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }
  reconcileChildren(fiber, fiber.props.children.flat());
}

// 每次只更新一级的fiber子树，这一个任务是不可打断的
function performUnitOfWork(fiber) {
  const isFunctionComponent = fiber.type instanceof Function;

  if (isFunctionComponent) {
    updateFunctionComponent(fiber);
  } else {
    updateHostComponent(fiber);
  }

  // return next unit of work
  // We first try with the child, then with the sibling, then with the uncle, and so on.
  // 向下或者向右继续遍历，都没有就向上找uncle
  if (fiber.child) {
    return fiber.child;
  }
  let nextFiber = fiber;
  completeWork(nextFiber);
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling;
    }
    completeWork(nextFiber.parent);
    nextFiber = nextFiber.parent;
  }
}

function createDom(fiber) {
  const dom =
    fiber.type === "TEXT_ELEMENT"
      ? document.createTextNode("")
      : document.createElement(fiber.type);

  updateDom(dom, {}, fiber.props);
  return dom;
}

export function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex];

  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  };

  const actions = oldHook ? oldHook.queue : [];

  actions.forEach(action => {
    hook.state = action(hook.state);
  });

  const setState = action => {
    hook.queue.push(action);
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    };
    nextUnitOfWork = wipRoot; // 启动更新
    deletions = [];
  };

  wipFiber.hooks.push(hook);
  hookIndex++;
  return [hook.state, setState];
}

export function useEffect(handler, deps) {
  const hook = {
    handler,
    deps,
  };
  wipFiber.hooks.push(hook);
  hookIndex++;
}

// 开始监听！
requestIdleCallback(workLoop);

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    alternate: currentRoot,
  };
  nextUnitOfWork = wipRoot;
  deletions = [];
}

const DidactDom = { render };
export default DidactDom;
